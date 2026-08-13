/**
 * `RecipeServiceClient` (T-004 / T-095) — the typed client for the Commise recipe management API
 * (`/api/v1/recipes`, `/api/v1/ingredients`, `/api/v1/collections`, `/api/v1/search`, `/api/v1/account`). It is the single
 * integration point the web and mobile apps use so they never hand-roll URLs, token attachment, or
 * status mapping. Modeled directly on `@kitchensink/food-service-client`.
 *
 * - **Token attach (user session or M2M).** A static bearer token or a `getToken` callback (re-read per
 *   request, so a rotated Clerk session token is always current) is sent as `Authorization: Bearer …`.
 * - **Typed results / errors.** Each method returns a DTO from `@kitchensink/recipe-core` (or a wire
 *   envelope from `./types.js`) on success and throws a typed error (see `./errors.js`) for
 *   `400`/`401`/`403`/`404`/`409`/`410`.
 * - **Base URL injected (never hardcoded, and never defaulted).** The consumer resolves it from its
 *   platform's validated config — `NEXT_PUBLIC_RECIPE_API_URL` on web (`web/src/config/env.ts`),
 *   `EXPO_PUBLIC_RECIPE_API_URL` on mobile (`mobile/src/config/env.ts`) — and injects it, exactly like
 *   `FoodServiceClient`. Both declare it with no fallback, so a misconfigured build fails rather than
 *   silently addressing localhost.
 */
import {
    IDENTITY_SYNC_PENDING_CODE,
    ingredientSchema,
    paginatedResponseSchema,
    recipeDetailSchema,
    recipePhotoSchema,
    recipeSchema,
    recipeVersionSchema,
    versionConflictDetailsSchema,
} from '@kitchensink/recipe-core';
import { z } from 'zod';
import type {
    Ingredient,
    PaginatedResponse,
    Recipe,
    RecipeDetail,
    RecipePhoto,
    RecipeVersion,
    RecipeVisibility,
} from '@kitchensink/recipe-core';
import ky, { HTTPError, TimeoutError } from 'ky';
import type { KyInstance, Options } from 'ky';

import { reportContractSkewOnce } from './contractSkew.js';
import {
    BadRequestError,
    FetchUnavailableError,
    ForbiddenError,
    GoneError,
    InvalidRequestError,
    NotFoundError,
    PullDriftError,
    RecipeServiceClientError,
    UnauthorizedError,
    UnexpectedResponseError,
    VersionConflictError,
} from './errors.js';
import type {
    CloneCollectionRequest,
    Collection,
    CollectionRecipeMembership,
    CollectionWithRecipes,
    CreateCollectionRequest,
    ErasureRequest,
    ErasureRequestAcceptedResponse,
    IngredientCandidate,
    IngredientSuggestions,
    ListCollectionsParams,
    ListRecipesParams,
    PhotoConfirmRequest,
    PhotoUploadUrlRequest,
    PullDiff,
    PullFromSourceResponse,
    RecipeSearchResponse,
    UpdateCollectionRequest,
    UploadUrlResponse,
} from './types.js';

// Runtime schemas from the GENERATED contract — the same zod the service validates with, so BOTH directions
// of every boundary are CHECKED rather than trusted. See CODING_STANDARDS §15.2 and ADR-0014.
//
// The `*RequestSchema` half is the OUTBOUND direction, and it was missing entirely: every write method
// serialized whatever it was handed. That is the same unfalsifiable-belief problem as an unparsed response,
// pointing the other way — a caller that builds a body this client's TYPES accept but the service's zod
// rejects learned about it from a `400` at runtime, with the service's field message as the only diagnosis,
// and a body carrying a field the contract does NOT accept (see `visibility` on the PATCH envelope) was sent
// and silently stripped. Parsing outbound makes the client refuse to send a body the published contract does
// not describe, at the call site that built it. It also NORMALIZES: zod strips unknown keys, so a stray field
// never reaches the wire.
import {
    addIngredientByFoodRequestSchema,
    addRecipeToCollectionRequestSchema,
    apiErrorSchema,
    cloneCollectionRequestSchema,
    collectionListResponseSchema,
    collectionRecipeMembershipResponseSchema,
    collectionResponseSchema,
    collectionWithRecipesResponseSchema,
    confirmPhotoRequestSchema,
    createCollectionRequestSchema,
    createIngredientRequestSchema,
    createPhotoUploadRequestSchema,
    createRecipeRequestSchema,
    erasureRequestAcceptedResponseSchema,
    erasureRequestSchema,
    ingredientCandidatesResponseSchema,
    ingredientSuggestionsResponseSchema,
    photoUploadUrlResponseSchema,
    pullDiffSchema,
    pullFromSourceRequestSchema,
    recipeApiErrorSchema,
    pullFromSourceResponseSchema,
    recipeSearchResponseSchema,
    reorderPhotosRequestSchema,
    resolveIngredientRequestSchema,
    restoreVersionResponseSchema,
    setRatingRequestSchema,
    setRecipeVisibilityRequestSchema,
    updateCollectionRequestSchema,
    updateRecipeRequestSchema,
} from '@kitchensink/schema-recipe';
import type {
    ApiErrorBody,
    CreateRecipeRequest,
    RecipeApiError,
    RecipeSearchQuery,
    RestoreVersionResponse,
    SetRatingRequest,
    UpdateRecipeRequest,
} from '@kitchensink/schema-recipe';

/**
 * A bearer token supplied either as a literal or a (sync/async) per-request callback. The callback
 * receives `{ forceRefresh }` — `true` when the client is retrying the first-token sync race, OR
 * bounded-single-retrying an ordinary expired-token `401`, and needs a freshly-minted token (the app
 * wires this to Clerk's `getToken({ skipCache: true })`). A callback that ignores the argument still
 * works — it simply returns its (possibly cached) token.
 */
export type TokenSource = string | ((options?: { readonly forceRefresh?: boolean }) => string | Promise<string>);

/**
 * Per-request timeout (ms) — the ceiling on how long ONE HTTP attempt may wait for the service to answer.
 *
 * A bounded wait is not a nicety, it is what makes a failure representable. Every read on the recipe
 * surfaces flows into a TanStack Query whose `isLoading` is `isPending && isFetching`: with no timeout, a
 * connection that never answers (an ALB target draining mid-deploy, a Fargate cold start, a stalled query, a
 * mobile network handoff that drops the socket without an RST) leaves the promise pending for the life of the
 * page, so the surface's loading branch never flips and BOTH its empty and error branches become unreachable
 * — the viewer gets a skeleton forever with no retry. 10s is generous for the JSON reads/writes this client
 * makes (the sibling `@kitchensink/food-service-client` uses 8s) and is deliberately longer than any healthy
 * p99, so it only ever fires on a genuine hang.
 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

/** Construction options. */
export interface RecipeServiceClientOptions {
    /** The recipe API base origin, e.g. `https://api.commise.app` (no trailing `/v1`). */
    readonly baseUrl: string;
    /** A user session or M2M bearer token (literal or per-request callback). */
    readonly token?: TokenSource;
    /** Injectable `fetch` (defaults to the global `fetch`) — enables test doubles. */
    readonly fetch?: typeof fetch;
    /**
     * Max automatic retries when the API returns `401` with `code: IDENTITY_SYNC_PENDING` (the
     * first-token sync race). Each retry re-reads the token with `{ forceRefresh: true }` after a backoff.
     * Default `3`; `0` disables.
     */
    readonly maxIdentitySyncRetries?: number;
    /**
     * Backoff (ms) before the Nth identity-sync retry (1-based); the last entry repeats when there are more
     * retries than entries. Default `[250, 500, 1000]` — gives identity's webhook time to backfill
     * `external_id` before the token is re-minted.
     */
    readonly identitySyncBackoffMs?: readonly number[];
    /** Injectable sleep (defaults to `setTimeout`) — enables instant retries in tests. */
    readonly sleep?: (ms: number) => Promise<void>;
    /**
     * Per-request timeout in milliseconds; defaults to {@link DEFAULT_REQUEST_TIMEOUT_MS}. A request that
     * exceeds it is ABORTED and rejects with {@link FetchUnavailableError}. Overridable per client (tests use
     * a few ms) but never disable-able: an unbounded wait is the defect this exists to prevent.
     */
    readonly timeoutMs?: number;
    /**
     * Where a contract-skew WARNING goes (drift layer 3, CODING_STANDARDS §15.2.5). Defaults to `console.warn`.
     *
     * This package has no logging seam of its own and this is not the place to invent one: a skew warning is
     * the ONLY thing this client ever emits out-of-band, so it gets one narrowly-named sink rather than a logger
     * abstraction nothing else would use. Supply it to route the warning into a real logger (Sentry on web, the
     * RN console on mobile), or to assert on it in a test.
     */
    readonly onContractSkew?: (message: string) => void;
}

/**
 * A normalized response: status and parsed JSON body (or `undefined` for empty/`204`).
 *
 * @notWireShape This client's own transport envelope — the recipe service never sends this object. It is what
 *   `normalizeResponse()` folds both a success `Response` and a thrown ky `HTTPError`'s response into, so one
 *   `toError` can map either by status; nothing in `@kitchensink/schema-recipe` describes it. (The wire BODIES
 *   it carries at `.body` are parsed against the published contract.)
 */
interface RawResponse {
    readonly status: number;
    readonly body: unknown;
}

/** A JSON-serializable query-parameter bag (scalars, or arrays for repeated params). */
type QueryParams = Record<string, string | number | boolean | readonly string[] | undefined>;

/**
 * Expand a query-parameter bag into `[key, value]` entries for ky's `searchParams` option. Arrays become
 * repeated entries (matching the OpenAPI `style=form, explode=true`) and `undefined` entries are dropped;
 * ky serializes the entries with `URLSearchParams`, so the wire output is identical to a hand-rolled
 * `?a=1&b=x&b=y`. Returns `[]` when the bag has no defined values (ky then appends no query string).
 */
function toSearchParamsEntries(params: QueryParams): [string, string][] {
    const entries: [string, string][] = [];

    for (const [key, value] of Object.entries(params)) {
        if (value === undefined) {
            continue;
        }

        if (Array.isArray(value)) {
            for (const item of value) {
                entries.push([key, String(item)]);
            }
        } else {
            entries.push([key, String(value as string | number | boolean)]);
        }
    }

    return entries;
}

/** Strip a leading `/` from a path so it joins onto ky's `prefixUrl` (which forbids a leading slash). */
function stripLeadingSlash(path: string): string {
    return path.replace(/^\/+/, '');
}

/** Parse `text` as JSON, or return `undefined` when it is not valid JSON (never throws). */
function safeJson(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return undefined;
    }
}

/**
 * Normalize a `fetch`/ky {@link Response} (a success response, or the one carried by a thrown
 * {@link HTTPError}) into a {@link RawResponse}: its status plus the parsed JSON body, or an `undefined`
 * body for an empty/`204` response.
 *
 * A **2xx** body must be JSON per the wire contract, so it is parsed strictly — a malformed one is a real
 * fault that must surface (and the typed methods then validate its shape via the response schema). A
 * **non-2xx** (error) body, however, is often NOT JSON: the shared internet-facing ALB emits an
 * HTML/plaintext page for `502`/`503`/`504` during every deploy, and many `500`s return a stack trace.
 * Parsing that strictly used to throw a raw `SyntaxError` that escaped `toError` entirely — so `is*`
 * guards returned `false` and consumers crashed generically instead of seeing a recoverable
 * service-unavailable state. Soften the error-body parse so `toError` maps by status (B16).
 *
 * @sideEffect Reads (consumes) the response body stream.
 */
async function normalizeResponse(response: Response): Promise<RawResponse> {
    const text = await response.text();

    if (text.length === 0) {
        return { status: response.status, body: undefined };
    }

    const body = response.ok ? JSON.parse(text) : safeJson(text);

    return { status: response.status, body };
}

export class RecipeServiceClient {
    private readonly baseUrl: string;
    private readonly token: TokenSource | undefined;
    private readonly maxIdentitySyncRetries: number;
    private readonly identitySyncBackoffMs: readonly number[];
    private readonly sleep: (ms: number) => Promise<void>;
    private readonly timeoutMs: number;
    /** The configured ky transport: base URL, token attach, JSON body/parse, and typed error throwing. */
    private readonly http: KyInstance;
    /**
     * The resolved `fetch`, kept for the drift-layer-3 skew probe (§15.2.5).
     *
     * The probe deliberately does NOT go through `this.http`: ky's `beforeRequest` hook would attach the
     * caller's bearer token, and `/health` is unauthenticated ON PURPOSE — a consumer checking for skew must be
     * able to ask before it holds a credential, and a background diagnostic has no business minting or spending
     * the viewer's token. Same instance as ky's, so an injected test double still sees the probe.
     */
    private readonly probeFetch: typeof fetch;
    /** Where a skew warning goes; `console.warn` unless the consumer supplied a sink. */
    private readonly onContractSkew: (message: string) => void;

    /** @param options - Base URL, optional token, an optional `fetch` double, and identity-sync retry config. */
    public constructor(options: RecipeServiceClientOptions) {
        this.baseUrl = options.baseUrl.replace(/\/+$/, '');
        this.token = options.token;
        this.maxIdentitySyncRetries = options.maxIdentitySyncRetries ?? 3;
        this.identitySyncBackoffMs = options.identitySyncBackoffMs ?? [250, 500, 1000];
        this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
        this.timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
        this.probeFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
        this.onContractSkew =
            options.onContractSkew ??
            ((message: string): void => {
                console.warn(message);
            });
        // NOTHING skew-related happens here. Constructing a client must not touch the network — a client is
        // composed wherever the app mounts a provider, and per-request on a server-rendered path. See
        // `./contractSkew.ts` for where the check fires instead, and why.
        this.http = ky.create({
            // ky appends the single joining slash; input paths are passed without a leading slash.
            prefixUrl: this.baseUrl,
            // The injected `fetch` (a test double) is used as-is; otherwise the platform global, bound to
            // `globalThis`. A BARE `fetch` reference handed to ky is invoked detached, which throws
            // `TypeError: Illegal invocation` in the browser (window.fetch must be called with `window` as
            // its receiver) — breaking every real browser request. Binding fixes it on web and is a no-op
            // in Node/RN. (Test doubles are plain functions and need no binding.)
            fetch: this.probeFetch,
            // Identity-sync retries are owned by `send()` (they inspect the body + re-mint the token), and
            // no other status is retried — so ky's own retry is disabled to preserve behavior.
            retry: 0,
            // The timeout, by contrast, is ky's to own: it aborts the request and rejects with ky's
            // `TimeoutError`, which `sendOnce` maps to `FetchUnavailableError`. It was `false` here (a
            // like-for-like carry-over of the hand-rolled `fetch` this client replaced), which left EVERY
            // request unbounded — see `DEFAULT_REQUEST_TIMEOUT_MS` for why that surfaced as a permanent
            // loading state rather than an error.
            timeout: this.timeoutMs,
            headers: { accept: 'application/json' },
            hooks: {
                beforeRequest: [
                    async (request, hookOptions) => {
                        const forceRefresh = hookOptions.context['forceRefresh'] === true;
                        const token = await this.resolveToken(forceRefresh);

                        if (token !== undefined) {
                            request.headers.set('authorization', `Bearer ${token}`);
                        }
                    },
                ],
            },
        });
    }

    // ─── Recipes ────────────────────────────────────────────────────────────────────────────────

    /**
     * `POST /api/v1/recipes` — create a recipe (`201`).
     *
     * @param input - The recipe draft.
     * @returns The created recipe.
     * @throws {BadRequestError} on validation failure; {@link UnauthorizedError} on auth failure.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async createRecipe(input: CreateRecipeRequest): Promise<RecipeDetail> {
        const res = await this.send(
            'POST',
            '/api/v1/recipes',
            this.request('createRecipe', createRecipeRequestSchema, input),
        );

        return this.expect(res, 201, recipeDetailSchema);
    }

    /**
     * `GET /api/v1/recipes` — list the caller's recipes (paginated).
     *
     * @param params - Pagination + sort.
     * @returns A paginated page of recipes.
     * @throws {UnauthorizedError} on auth failure.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async listRecipes(params: ListRecipesParams = {}): Promise<PaginatedResponse<Recipe>> {
        const res = await this.send('GET', '/api/v1/recipes', undefined, {
            page: params.page,
            pageSize: params.pageSize,
            sortBy: params.sortBy,
        });

        return this.expect(res, 200, paginatedResponseSchema(recipeSchema));
    }

    /**
     * `GET /api/v1/recipes/{id}` — read a recipe by id.
     *
     * @param id - The recipe id.
     * @returns The recipe.
     * @throws {NotFoundError} when absent/tombstoned; {@link ForbiddenError} when not the owner.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async getRecipeById(id: string): Promise<RecipeDetail> {
        const res = await this.send('GET', `/api/v1/recipes/${encodeURIComponent(id)}`);

        return this.expect(res, 200, recipeDetailSchema);
    }

    /**
     * `PATCH /api/v1/recipes/{id}` — update a recipe with optimistic concurrency.
     *
     * @param id - The recipe id.
     * @param input - The partial update carrying the caller's `expectedVersion`.
     * @returns The updated recipe.
     * @throws {VersionConflictError} on a stale `expectedVersion`; {@link ForbiddenError} when not owner.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async updateRecipe(id: string, input: UpdateRecipeRequest): Promise<RecipeDetail> {
        const res = await this.send(
            'PATCH',
            `/api/v1/recipes/${encodeURIComponent(id)}`,
            this.request('updateRecipe', updateRecipeRequestSchema, input),
        );

        return this.expect(res, 200, recipeDetailSchema);
    }

    /**
     * `DELETE /api/v1/recipes/{id}` — soft-delete (tombstone) a recipe (`204`).
     *
     * @param id - The recipe id.
     * @throws {ForbiddenError} when not the owner; {@link NotFoundError} when absent.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async deleteRecipe(id: string): Promise<void> {
        const res = await this.send('DELETE', `/api/v1/recipes/${encodeURIComponent(id)}`);

        return this.expectNoContent(res, 204);
    }

    /**
     * `POST /api/v1/recipes/{id}/clone` — clone a public recipe into the caller's library (`201`).
     *
     * @param id - The source recipe id.
     * @returns The newly created clone.
     * @throws {ForbiddenError} when the source is not clonable; {@link NotFoundError} when absent.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async cloneRecipe(id: string): Promise<RecipeDetail> {
        const res = await this.send('POST', `/api/v1/recipes/${encodeURIComponent(id)}/clone`);

        return this.expect(res, 201, recipeDetailSchema);
    }

    /**
     * `PATCH /api/v1/recipes/{id}/visibility` — set a recipe's visibility.
     *
     * @param id - The recipe id.
     * @param visibility - The new visibility.
     * @returns The updated recipe.
     * @throws {ForbiddenError} when not the owner; {@link BadRequestError} on an invalid value.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async setRecipeVisibility(id: string, visibility: RecipeVisibility): Promise<RecipeDetail> {
        const res = await this.send(
            'PATCH',
            `/api/v1/recipes/${encodeURIComponent(id)}/visibility`,
            this.request('setRecipeVisibility', setRecipeVisibilityRequestSchema, { visibility }),
        );

        return this.expect(res, 200, recipeDetailSchema);
    }

    /**
     * `PUT /api/v1/recipes/{id}/rating` — set the caller's rating of a recipe (idempotent upsert, FR-013).
     *
     * The rater is the authenticated caller (the bearer token) — there is deliberately no rater field in
     * the body. Re-rating replaces the caller's previous rating; sending the same request twice has the
     * same effect as sending it once.
     *
     * @param id - The recipe id.
     * @param input - The `{ stars }` body (whole 1–5).
     * @returns The recipe with its recomputed `averageRating` / `ratingCount`.
     * @throws {ForbiddenError} (`CANNOT_RATE_OWN_RECIPE`) when the caller owns the recipe;
     *   {@link NotFoundError} when the recipe is absent OR not visible to the caller.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async setRecipeRating(id: string, input: SetRatingRequest): Promise<RecipeDetail> {
        const res = await this.send(
            'PUT',
            `/api/v1/recipes/${encodeURIComponent(id)}/rating`,
            this.request('setRecipeRating', setRatingRequestSchema, input),
        );

        return this.expect(res, 200, recipeDetailSchema);
    }

    /**
     * `DELETE /api/v1/recipes/{id}/rating` — remove the caller's rating of a recipe (`204`, FR-013).
     *
     * Idempotent: removing a rating that does not exist still succeeds with `204`.
     *
     * @param id - The recipe id.
     * @throws {NotFoundError} when the recipe is absent OR not visible to the caller.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async deleteRecipeRating(id: string): Promise<void> {
        const res = await this.send('DELETE', `/api/v1/recipes/${encodeURIComponent(id)}/rating`);

        return this.expectNoContent(res, 204);
    }

    // ─── Ingredients ────────────────────────────────────────────────────────────────────────────

    /**
     * `GET /api/v1/ingredients/search` — typeahead ingredient search (thin proxy over the food service).
     *
     * @param query - The name query.
     * @param limit - Max results (1–50; server default 10).
     * @returns Matching ingredients (nutrition resolves asynchronously; see `foodResolutionStatus`).
     * @throws {UnauthorizedError} on auth failure.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async searchIngredients(query: string, limit?: number): Promise<readonly Ingredient[]> {
        const res = await this.send('GET', '/api/v1/ingredients/search', undefined, { q: query, limit });

        return this.expect(res, 200, z.array(ingredientSchema));
    }

    /**
     * `GET /api/v1/ingredients/suggest` — the BLENDED ingredient typeahead (search Stage 2): the recipe-service
     * `ingredients` catalog **plus** the food-service golden catalog, deduped on the opaque food id and
     * sectioned by provenance (all `local` suggestions precede all `catalog` ones).
     *
     * Distinct from {@link searchIngredients}, which stays local-only: `/search` returns `Ingredient[]` whose
     * ids are usable as recipe-line / search-filter values, whereas a `catalog` suggestion has no ingredient
     * id yet and must be admitted with {@link addIngredientByFood} when the user picks it.
     *
     * The response's `catalogAvailability` reports whether the food catalog contributed: the endpoint degrades
     * to local-only rather than failing when the food service is slow or down, so treat `'unavailable'` as
     * "fewer suggestions, tell the user" — never as an error.
     *
     * @param query - The name query.
     * @param limit - Max results PER SECTION (1–50; server default 10).
     * @returns The blended suggestions plus the catalog's availability.
     * @throws {BadRequestError} on a blank query; {@link UnauthorizedError} on auth failure.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async suggestIngredients(query: string, limit?: number): Promise<IngredientSuggestions> {
        const res = await this.send('GET', '/api/v1/ingredients/suggest', undefined, { q: query, limit });

        return this.expect(res, 200, ingredientSuggestionsResponseSchema);
    }

    /**
     * `POST /api/v1/ingredients/by-food` — admit a `catalog` suggestion as a food-backed ingredient (`200`).
     *
     * The Stage-2 pick path. The server reads the food's golden record, creates (or dedup-returns) the
     * `ingredients` row with the food service's OWN display name, and writes the per-100g nutrition +
     * household portions through before responding — so the ingredient this resolves with already carries
     * nutrition. That is why it is `200`, not `by-name`'s `202`: there is nothing to poll for a seeded,
     * already-`RESOLVED` food. `foodResolutionStatus` on the body remains authoritative, so the rare
     * still-resolving food routes through the same poll/disambiguate machinery as `by-name`.
     *
     * The body carries ONLY `foodId` by design — the display name is never client-supplied, because
     * `ingredients` is an ownerless catalog shared by every user.
     *
     * @param foodId - The opaque food id from a `catalog` suggestion.
     * @returns The food-backed ingredient, with its golden-record nutrition.
     * @throws {BadRequestError} when the food cannot back an ingredient (unknown, terminal, still resolving,
     *   or nameless) or `foodId` is blank/oversized; {@link UnauthorizedError} on auth failure.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async addIngredientByFood(foodId: string): Promise<Ingredient> {
        const res = await this.send(
            'POST',
            '/api/v1/ingredients/by-food',
            this.request('addIngredientByFood', addIngredientByFoodRequestSchema, { foodId }),
        );

        return this.expect(res, 200, ingredientSchema);
    }

    /**
     * `POST /api/v1/ingredients` — create a freeform ingredient (`201`).
     *
     * @param name - The ingredient name.
     * @returns The created ingredient.
     * @throws {BadRequestError} on an empty/oversized name; {@link UnauthorizedError} on auth failure.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async createIngredient(name: string): Promise<Ingredient> {
        const res = await this.send(
            'POST',
            '/api/v1/ingredients',
            this.request('createIngredient', createIngredientRequestSchema, { name }),
        );

        return this.expect(res, 201, ingredientSchema);
    }

    /**
     * `POST /api/v1/ingredients/by-name` — add an unknown food by name through the source-agnostic food service
     * (`202`, data-model R5). The ENTRY POINT of the async-resolution vertical: the server persists a
     * food-backed catalog row and returns it with a NON-terminal `foodResolutionStatus` (`PENDING` /
     * `UNRESOLVED`). `202 Accepted` (not `201`) signals that nutrition resolution is asynchronous and
     * incomplete — poll {@link getIngredientStatus} while `PENDING`, or disambiguate an `UNRESOLVED` row via
     * {@link getIngredientCandidates} / {@link resolveIngredient}.
     *
     * @param name - The food name to add.
     * @returns The created (or deduped) food-backed ingredient with its non-terminal resolution status.
     * @throws {BadRequestError} on an empty/oversized name; {@link UnauthorizedError} on auth failure.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async addIngredientByName(name: string): Promise<Ingredient> {
        const res = await this.send(
            'POST',
            '/api/v1/ingredients/by-name',
            this.request('addIngredientByName', createIngredientRequestSchema, { name }),
        );

        return this.expect(res, 202, ingredientSchema);
    }

    /**
     * `GET /api/v1/ingredients/{id}/status` — poll a food-backed ingredient's async resolution (data-model R5).
     *
     * The server re-reads the food service, persists the current status (and golden-record nutrition once
     * `RESOLVED`), and returns the refreshed ingredient. Poll while `foodResolutionStatus` is `PENDING`;
     * stop on any terminal/resolved/unresolved state (see `useIngredientStatus`).
     *
     * @param id - The ingredient id.
     * @returns The refreshed ingredient with its current resolution status.
     * @throws {NotFoundError} when the ingredient is absent; {@link UnauthorizedError} on auth failure.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async getIngredientStatus(id: string): Promise<Ingredient> {
        const res = await this.send('GET', `/api/v1/ingredients/${encodeURIComponent(id)}/status`);

        return this.expect(res, 200, ingredientSchema);
    }

    /**
     * `GET /api/v1/ingredients/{id}/candidates` — the disambiguation candidate set for an `UNRESOLVED` ingredient.
     *
     * @param id - The ingredient id.
     * @returns The candidate foods to pick from (empty for a freeform or non-`UNRESOLVED` ingredient).
     * @throws {NotFoundError} when the ingredient is absent; {@link UnauthorizedError} on auth failure.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async getIngredientCandidates(id: string): Promise<readonly IngredientCandidate[]> {
        const res = await this.send('GET', `/api/v1/ingredients/${encodeURIComponent(id)}/candidates`);

        return this.expect(res, 200, ingredientCandidatesResponseSchema);
    }

    /**
     * `POST /api/v1/ingredients/{id}/resolve` — resolve an `UNRESOLVED` ingredient from a candidate pick (`200`).
     *
     * The server resolves the food from the chosen candidate id(s) then re-polls so the newly-`RESOLVED`
     * nutrition is persisted; the returned ingredient carries the resolved status + nutrition.
     *
     * @param id - The ingredient id.
     * @param candidateIds - The picked candidate ids (non-empty).
     * @returns The refreshed, resolved ingredient.
     * @throws {BadRequestError} on an empty/invalid `candidateIds`; {@link NotFoundError} when absent.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async resolveIngredient(id: string, candidateIds: readonly string[]): Promise<Ingredient> {
        const res = await this.send(
            'POST',
            `/api/v1/ingredients/${encodeURIComponent(id)}/resolve`,
            this.request('resolveIngredient', resolveIngredientRequestSchema, { candidateIds }),
        );

        return this.expect(res, 200, ingredientSchema);
    }

    // ─── Versions ───────────────────────────────────────────────────────────────────────────────

    /**
     * `GET /api/v1/recipes/{id}/versions` — list a recipe's recent versions (up to 10).
     *
     * @param id - The recipe id.
     * @returns The version list.
     * @throws {ForbiddenError} when not the owner; {@link NotFoundError} when absent.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async listRecipeVersions(id: string): Promise<readonly RecipeVersion[]> {
        const res = await this.send('GET', `/api/v1/recipes/${encodeURIComponent(id)}/versions`);

        return this.expect(res, 200, z.array(recipeVersionSchema));
    }

    /**
     * `GET /api/v1/recipes/{id}/versions/{versionNumber}` — read a specific version snapshot.
     *
     * @param id - The recipe id.
     * @param versionNumber - The 1-based version number.
     * @returns The version snapshot.
     * @throws {NotFoundError} when the recipe/version is absent; {@link ForbiddenError} when not owner.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async getRecipeVersion(id: string, versionNumber: number): Promise<RecipeVersion> {
        const res = await this.send(
            'GET',
            `/api/v1/recipes/${encodeURIComponent(id)}/versions/${encodeURIComponent(String(versionNumber))}`,
        );

        return this.expect(res, 200, recipeVersionSchema);
    }

    /**
     * `POST /api/v1/recipes/{id}/versions/{versionNumber}/restore` — restore a recipe to a prior version.
     *
     * @param id - The recipe id.
     * @param versionNumber - The version to restore from.
     * @returns The restored recipe + version metadata.
     * @throws {VersionConflictError} on a concurrent update; {@link ForbiddenError} when not the owner.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async restoreRecipeVersion(id: string, versionNumber: number): Promise<RestoreVersionResponse> {
        const res = await this.send(
            'POST',
            `/api/v1/recipes/${encodeURIComponent(id)}/versions/${encodeURIComponent(String(versionNumber))}/restore`,
        );

        return this.expect(res, 200, restoreVersionResponseSchema);
    }

    // ─── Photos ─────────────────────────────────────────────────────────────────────────────────

    /**
     * `POST /api/v1/recipes/{id}/photos/upload-url` — mint a presigned S3 URL for a direct client upload.
     *
     * @param id - The recipe id.
     * @param request - File name, content type, and size (≤ 5 MiB).
     * @returns The presigned upload URL + object key.
     * @throws {ForbiddenError} when not the owner; {@link NotFoundError} when the recipe is absent.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async createPhotoUploadUrl(id: string, request: PhotoUploadUrlRequest): Promise<UploadUrlResponse> {
        const res = await this.send(
            'POST',
            `/api/v1/recipes/${encodeURIComponent(id)}/photos/upload-url`,
            this.request('createPhotoUploadUrl', createPhotoUploadRequestSchema, request),
        );

        return this.expect(res, 200, photoUploadUrlResponseSchema);
    }

    /**
     * `POST /api/v1/recipes/{id}/photos/confirm` — associate an uploaded object key with the recipe (`201`).
     *
     * @param id - The recipe id.
     * @param request - The uploaded object key + content type.
     * @returns The created photo record.
     * @throws {BadRequestError} when the max photo count is exceeded; {@link ForbiddenError} when not owner.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async confirmPhotoUpload(id: string, request: PhotoConfirmRequest): Promise<RecipePhoto> {
        const res = await this.send(
            'POST',
            `/api/v1/recipes/${encodeURIComponent(id)}/photos/confirm`,
            this.request('confirmPhotoUpload', confirmPhotoRequestSchema, request),
        );

        return this.expect(res, 201, recipePhotoSchema);
    }

    /**
     * `GET /api/v1/recipes/{id}/photos` — list a recipe's photos.
     *
     * @param id - The recipe id.
     * @returns The photos, in display order.
     * @throws {NotFoundError} when the recipe is absent.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async listRecipePhotos(id: string): Promise<readonly RecipePhoto[]> {
        const res = await this.send('GET', `/api/v1/recipes/${encodeURIComponent(id)}/photos`);

        return this.expect(res, 200, z.array(recipePhotoSchema));
    }

    /**
     * `DELETE /api/v1/recipes/{id}/photos/{photoId}` — delete a photo (`204`).
     *
     * @param id - The recipe id.
     * @param photoId - The photo id.
     * @throws {ForbiddenError} when not the owner; {@link NotFoundError} when absent.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async deleteRecipePhoto(id: string, photoId: string): Promise<void> {
        const res = await this.send(
            'DELETE',
            `/api/v1/recipes/${encodeURIComponent(id)}/photos/${encodeURIComponent(photoId)}`,
        );

        return this.expectNoContent(res, 204);
    }

    /**
     * `PATCH /api/v1/recipes/{id}/photos/reorder` — set the final display order of a recipe's photos.
     *
     * @param id - The recipe id.
     * @param photoIds - The photo ids in the desired order (1–10).
     * @returns The reordered photos.
     * @throws {ForbiddenError} when not the owner; {@link NotFoundError} when absent.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async reorderRecipePhotos(id: string, photoIds: readonly string[]): Promise<readonly RecipePhoto[]> {
        const res = await this.send(
            'PATCH',
            `/api/v1/recipes/${encodeURIComponent(id)}/photos/reorder`,
            this.request('reorderRecipePhotos', reorderPhotosRequestSchema, { photoIds }),
        );

        return this.expect(res, 200, z.array(recipePhotoSchema));
    }

    // ─── Collections ────────────────────────────────────────────────────────────────────────────

    /**
     * `POST /api/v1/collections` — create a collection (`201`).
     *
     * @param request - Name + optional description/visibility.
     * @returns The created collection.
     * @throws {BadRequestError} on validation failure; {@link UnauthorizedError} on auth failure.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async createCollection(request: CreateCollectionRequest): Promise<Collection> {
        const res = await this.send(
            'POST',
            '/api/v1/collections',
            this.request('createCollection', createCollectionRequestSchema, request),
        );

        return this.expect(res, 201, collectionResponseSchema);
    }

    /**
     * `GET /api/v1/collections` — list the caller's collections (paginated).
     *
     * @param params - Pagination.
     * @returns A paginated page of collections.
     * @throws {UnauthorizedError} on auth failure.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async listCollections(params: ListCollectionsParams = {}): Promise<PaginatedResponse<Collection>> {
        const res = await this.send('GET', '/api/v1/collections', undefined, {
            page: params.page,
            pageSize: params.pageSize,
        });

        return this.expect(res, 200, collectionListResponseSchema);
    }

    /**
     * `GET /api/v1/collections/{id}` — read a collection with its member recipes.
     *
     * @param id - The collection id.
     * @returns The collection + recipes.
     * @throws {ForbiddenError} when not the owner; {@link NotFoundError} when absent.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async getCollectionById(id: string): Promise<CollectionWithRecipes> {
        const res = await this.send('GET', `/api/v1/collections/${encodeURIComponent(id)}`);

        return this.expect(res, 200, collectionWithRecipesResponseSchema);
    }

    /**
     * `PATCH /api/v1/collections/{id}` — update a collection.
     *
     * @param id - The collection id.
     * @param request - The partial update (at least one field).
     * @returns The updated collection.
     * @throws {ForbiddenError} when not the owner; {@link BadRequestError} on validation failure.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async updateCollection(id: string, request: UpdateCollectionRequest): Promise<Collection> {
        const res = await this.send(
            'PATCH',
            `/api/v1/collections/${encodeURIComponent(id)}`,
            this.request('updateCollection', updateCollectionRequestSchema, request),
        );

        return this.expect(res, 200, collectionResponseSchema);
    }

    /**
     * `DELETE /api/v1/collections/{id}` — delete a collection (`204`).
     *
     * @param id - The collection id.
     * @throws {ForbiddenError} when not the owner; {@link NotFoundError} when absent.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async deleteCollection(id: string): Promise<void> {
        const res = await this.send('DELETE', `/api/v1/collections/${encodeURIComponent(id)}`);

        return this.expectNoContent(res, 204);
    }

    /**
     * `POST /api/v1/collections/{id}/recipes` — add a recipe to a collection (`201`).
     *
     * @param id - The collection id.
     * @param recipeId - The recipe to add.
     * @returns The created membership record.
     * @throws {ForbiddenError} when not the owner; {@link NotFoundError} when either is absent.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async addRecipeToCollection(id: string, recipeId: string): Promise<CollectionRecipeMembership> {
        const res = await this.send(
            'POST',
            `/api/v1/collections/${encodeURIComponent(id)}/recipes`,
            this.request('addRecipeToCollection', addRecipeToCollectionRequestSchema, { recipeId }),
        );

        return this.expect(res, 201, collectionRecipeMembershipResponseSchema);
    }

    /**
     * `DELETE /api/v1/collections/{id}/recipes/{recipeId}` — remove a recipe from a collection (`204`).
     *
     * @param id - The collection id.
     * @param recipeId - The recipe to remove.
     * @throws {ForbiddenError} when not the owner; {@link NotFoundError} when absent.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async removeRecipeFromCollection(id: string, recipeId: string): Promise<void> {
        const res = await this.send(
            'DELETE',
            `/api/v1/collections/${encodeURIComponent(id)}/recipes/${encodeURIComponent(recipeId)}`,
        );

        return this.expectNoContent(res, 204);
    }

    /**
     * `POST /api/v1/collections/{id}/clone` — clone a collection into the caller's library (`201`).
     *
     * @param id - The source collection id.
     * @param request - Optional name/description overrides.
     * @returns The newly created clone.
     * @throws {ForbiddenError} when the source is not clonable; {@link NotFoundError} when absent.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async cloneCollection(id: string, request?: CloneCollectionRequest): Promise<Collection> {
        const res = await this.send(
            'POST',
            `/api/v1/collections/${encodeURIComponent(id)}/clone`,
            // `optionalRequest`, not `request(… ?? {})`: `cloneCollectionRequestSchema` carries `.default({})`, so
            // parsing `undefined` would MATERIALIZE a `{}` body and this endpoint deliberately sends none.
            this.optionalRequest('cloneCollection', cloneCollectionRequestSchema, request),
        );

        return this.expect(res, 201, collectionResponseSchema);
    }

    /**
     * `POST /api/v1/collections/{id}/pull-from-source/preview` — PREVIEW a pull without mutating (W5 Task 5).
     * Read-only: the server runs this in a read-only transaction, so it is structurally incapable of
     * writing. Show the returned diff to the caller, then echo it back as `previewedDiff` on
     * {@link pullCollectionFromSource} so the commit can detect drift between preview and commit.
     *
     * @param id - The (cloned) collection id.
     * @returns The `{ added, removed, unchanged }` diff pulling would apply.
     * @throws {BadRequestError} (`COLLECTION_NOT_CLONED`) when the collection has no source to pull from.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async previewPullFromSource(id: string): Promise<PullDiff> {
        const res = await this.send('POST', `/api/v1/collections/${encodeURIComponent(id)}/pull-from-source/preview`);

        return this.expect(res, 200, pullDiffSchema);
    }

    /**
     * `POST /api/v1/collections/{id}/pull-from-source` — pull new recipes from a cloned collection's source.
     *
     * @param id - The (cloned) collection id.
     * @param body - Optionally echoes the `previewedDiff` from {@link previewPullFromSource}; when present,
     *   the server re-derives the diff live and rejects with {@link PullDriftError} (carrying the fresh
     *   diff) if it no longer matches — so the caller never silently applies a set the user did not confirm.
     * @returns The resulting collection + the recipe ids this pull added.
     * @throws {BadRequestError} (`COLLECTION_NOT_CLONED`) when the collection has no source to pull from.
     * @throws {PullDriftError} when the previewed diff drifted from the live one (`PULL_DRIFT`, `409`).
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async pullCollectionFromSource(
        id: string,
        body?: { readonly previewedDiff?: PullDiff },
    ): Promise<PullFromSourceResponse> {
        const res = await this.send(
            'POST',
            `/api/v1/collections/${encodeURIComponent(id)}/pull-from-source`,
            this.optionalRequest('pullCollectionFromSource', pullFromSourceRequestSchema, body),
        );

        return this.expect(res, 200, pullFromSourceResponseSchema);
    }

    // ─── Search & account ───────────────────────────────────────────────────────────────────────

    /**
     * `GET /api/v1/search/recipes` — full-text recipe search with facets.
     *
     * @param params - Query, filters, pagination, and sort.
     * @returns Ranked results + facet counts.
     * @throws {UnauthorizedError} on auth failure.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async searchRecipes(params: RecipeSearchQuery = {}): Promise<RecipeSearchResponse> {
        const res = await this.send('GET', '/api/v1/search/recipes', undefined, {
            query: params.query,
            cuisine: params.cuisine,
            dietaryFlags: params.dietaryFlags,
            tags: params.tags,
            maxPrepTime: params.maxPrepTime,
            maxCookTime: params.maxCookTime,
            maxTotalTime: params.maxTotalTime,
            ingredientIds: params.ingredientIds,
            page: params.page,
            pageSize: params.pageSize,
            sortBy: params.sortBy,
        });

        return this.expect(res, 200, recipeSearchResponseSchema);
    }

    /**
     * `POST /api/v1/account/erasure` — request IRREVERSIBLE GDPR account erasure (`202`, idempotent).
     *
     * The `request` argument is REQUIRED, and that is a deliberate tightening: `confirmationPhrase` is the
     * intent gate on an unrecoverable action, so a call with no argument could only ever have produced a
     * `400`. It was optional here purely as a leftover from when the phrase itself was optional. Both
     * production call sites already pass a full body.
     *
     * @param request - The confirmation phrase, plus the optional per-recipe donate election.
     * @returns The (possibly pre-existing) erasure job id + status.
     * @throws {BadRequestError} (`400`) when the phrase is absent, empty, or does not match.
     * @throws {GoneError} (`410`) when the account has already been erased; {@link UnauthorizedError} on auth.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async requestAccountErasure(request: ErasureRequest): Promise<ErasureRequestAcceptedResponse> {
        const res = await this.send(
            'POST',
            '/api/v1/account/erasure',
            this.request('requestAccountErasure', erasureRequestSchema, request),
        );

        return this.expect(res, 202, erasureRequestAcceptedResponseSchema);
    }

    // ─── Transport ──────────────────────────────────────────────────────────────────────────────

    /**
     * Issue an authenticated request and normalize the response (status + parsed body).
     *
     * Two DISTINCT `401` retry paths live here, and they must not be conflated:
     *  1. **First-token sync race** (`401` `IDENTITY_SYNC_PENDING`) — retried per the configured backoff
     *     (`maxIdentitySyncRetries` attempts, force-refreshing the token each time).
     *  2. **Ordinary expired-token `401`** (any other/absent `code`) — once the sync-race loop above has
     *     run its course (it never even starts when the first response isn't sync-pending), an ordinary
     *     `401` gets exactly ONE bounded retry: force-refresh the token via the `TokenSource` and replay
     *     the request. If the retry ALSO 401s, that response is returned as-is (surfacing
     *     `UnauthorizedError` below) — there is no second retry, so a persistently-invalid token fails
     *     fast instead of looping.
     *
     * No other status is retried.
     *
     * @param method - HTTP method.
     * @param path - Path beginning with `/`.
     * @param body - Optional JSON body.
     * @param query - Optional query-parameter bag (serialized by ky's `searchParams`).
     * @returns The normalized response.
     * @sideEffect Performs a network request via the injected `fetch`.
     */
    private async send(method: string, path: string, body?: unknown, query?: QueryParams): Promise<RawResponse> {
        let res = await this.sendOnce(method, path, body, query, false);

        for (let attempt = 1; attempt <= this.maxIdentitySyncRetries && isIdentitySyncPending(res); attempt += 1) {
            const backoff = this.identitySyncBackoffMs[Math.min(attempt, this.identitySyncBackoffMs.length) - 1] ?? 0;
            await this.sleep(backoff);
            res = await this.sendOnce(method, path, body, query, true);
        }

        // Ordinary expired-token 401 (NOT the identity-sync-pending case, which is handled — and possibly
        // exhausted — by the loop above): force a fresh token and retry exactly once. Bounded — the result
        // of this single retry (success OR another 401) is returned as-is, never looped.
        if (res.status === 401 && !isIdentitySyncPending(res)) {
            res = await this.sendOnce(method, path, body, query, true);
        }

        // DRIFT LAYER 3 (Skew), consumer half — CODING_STANDARDS §15.2.5, owner ruling 2026-08-11: a mismatch
        // WARNS, it does not refuse. Fired HERE, after a response has been received, and deliberately NOT
        // awaited: it must add no latency, change no response, and never throw. Placed after the retry loops so
        // one logical call produces at most one probe attempt, and once per ORIGIN per process rather than per
        // client instance (a client may be constructed per server-rendered request). See `./contractSkew.ts`.
        reportContractSkewOnce({ baseUrl: this.baseUrl, fetch: this.probeFetch, warn: this.onContractSkew });

        return res;
    }

    /**
     * Perform a single authenticated request via ky and normalize the response (status + parsed body). ky
     * attaches the bearer token (its `beforeRequest` hook), serializes the JSON body, and throws an
     * {@link HTTPError} on a non-2xx status; both the success response and the error's response are folded
     * back into a {@link RawResponse} so `toError` maps the status to a typed error exactly as before.
     *
     * @param forceRefresh - Forwarded (via ky's request `context`) to a callback token source so a retry
     *   re-mints (skips the cache).
     * @sideEffect Performs a network request via the injected `fetch`.
     */
    private async sendOnce(
        method: string,
        path: string,
        body: unknown,
        query: QueryParams | undefined,
        forceRefresh: boolean,
    ): Promise<RawResponse> {
        const options: Options = { method, context: { forceRefresh } };

        if (body !== undefined) {
            options.json = body;
        }

        const searchParams = query ? toSearchParamsEntries(query) : [];

        if (searchParams.length > 0) {
            options.searchParams = searchParams;
        }

        try {
            return await normalizeResponse(await this.http(stripLeadingSlash(path), options));
        } catch (error) {
            if (error instanceof HTTPError) {
                return normalizeResponse(error.response);
            }

            // A timeout is NOT a response — there is no status to map — so it cannot be folded into a
            // `RawResponse`. Re-throwing it as a typed client error (rather than leaking ky's own
            // `TimeoutError`) keeps the transport's contract "typed result or typed error", and lets a
            // consumer tell "the service did not answer" apart from "the service said no". It is thrown, not
            // returned, precisely so `send()`'s two 401 retry paths cannot replay it — a retried timeout
            // would multiply the bounded wait straight back toward the unbounded one.
            if (error instanceof TimeoutError) {
                throw new FetchUnavailableError(
                    `Recipe service did not respond within ${this.timeoutMs}ms (${method} ${path})`,
                    error,
                );
            }

            throw error;
        }
    }

    /**
     * Resolve the configured token (literal or callback), or `undefined` for an unauthenticated call.
     *
     * @param forceRefresh - Passed to a callback token source so it can re-mint (skip cache) on a retry.
     */
    private async resolveToken(forceRefresh: boolean): Promise<string | undefined> {
        if (this.token === undefined) {
            return undefined;
        }

        return typeof this.token === 'function' ? this.token({ forceRefresh }) : this.token;
    }

    /**
     * On the expected success `status`, **parse** the body with `schema` and return the validated value;
     * otherwise throw the typed error for the status. This is parse-don't-validate at the wire boundary
     * (DA1): the transport returns *validated domain values*, not `as`-casts, so a server response that
     * has drifted from `@kitchensink/recipe-core` fails loudly here at the edge (a typed parse error)
     * instead of surfacing as a mystery `undefined` deep in a component. The `as T` bridges the schema's
     * inferred output to the hand-written DTO interface — safe because `schema.parse` already validated
     * the runtime shape. Collapses the ~25 repeated `if (status) return body as T; throw toError` blocks
     * into one place (P6).
     *
     * EVERY success boundary in this client now goes through here or {@link expectNoContent}. Its sibling
     * `expectUnvalidated` — which returned `res.body as T` for envelopes that had no shared schema — is
     * DELETED: the four boundaries that still used it (`getCollectionById`, `addRecipeToCollection`,
     * `pullCollectionFromSource`, `requestAccountErasure`) are described by the generated contract now, so
     * there is no longer a response body this client trusts without parsing.
     *
     * @throws the typed error (via {@link toError}) on any non-`status` response, or a `ZodError` when the
     *   `status` body fails the schema.
     */
    private expect<T>(res: RawResponse, status: number, schema: z.ZodType): T {
        if (res.status === status) {
            return schema.parse(res.body) as T;
        }

        throw this.toError(res);
    }

    /**
     * Parse an OUTBOUND body against the request schema the service publishes, and return the parsed value.
     *
     * PARSE, DON'T VALIDATE — in the direction that was missing. Every write method used to hand `send()`
     * whatever it was given, so this client's only statement about a request body was a TypeScript annotation
     * that erases at runtime. Three concrete consequences, all of which this closes:
     *
     *  - A body that satisfied the client's TYPES but violated the schema's BOUNDS (`title` at 201 characters,
     *    `servings: 9999999999` against an int4 column) left as a request and came back as the service's
     *    `400` — or, before those ceilings existed, its `500`. The rule was published; nothing on this side
     *    ran it.
     *  - A body carrying a field the contract does NOT accept was sent and silently dropped. `visibility` on
     *    `PATCH /api/v1/recipes/{id}` is the live case: the editor sent it for as long as it existed and the
     *    service stripped it, so the client believed it had set something it had not.
     *  - The failure surfaced a network round-trip away from the code that built the body, described by the
     *    server's message rather than the field path.
     *
     * zod's key-stripping is doing real work here beyond checking: the parsed value is NORMALIZED, so a stray
     * property on a caller's object literal cannot reach the wire even when structural typing admitted it.
     *
     * @param operation - The method name, for the error message.
     * @param schema - The published request schema for this endpoint.
     * @param body - The caller's body.
     * @returns The parsed (and key-stripped) body.
     * @throws {InvalidRequestError} when the body does not satisfy the published contract — deliberately NOT a
     *   `BadRequestError`, which means "the server said 400" and is a different fault with a different fix.
     */
    private request<S extends z.ZodType>(operation: string, schema: S, body: unknown): z.output<S> {
        const parsed = schema.safeParse(body);

        if (!parsed.success) {
            throw new InvalidRequestError(operation, parsed.error);
        }

        return parsed.data as z.output<S>;
    }

    /**
     * Like {@link request}, but preserves an ABSENT body as absent.
     *
     * Needed because two endpoints (`POST /collections/{id}/clone`, `POST /collections/{id}/pull-from-source`)
     * legitimately take no body at all, and their published schemas carry `.default({})` — which is what makes a
     * bodyless `POST` legal server-side. Feeding `undefined` through `parse` would satisfy the default and hand
     * back `{}`, so the client would start sending `Content-Type: application/json` and a `{}` payload where it
     * previously sent nothing. That is a wire change dressed as a validation change, which is exactly the kind of
     * incidental drift this whole exercise exists to stop, so the absent case short-circuits.
     *
     * @param operation - The method name, for the error message.
     * @param schema - The published request schema for this endpoint.
     * @param body - The caller's body, or `undefined` for a bodyless request.
     * @returns The parsed body, or `undefined` when none was supplied.
     * @throws {InvalidRequestError} when a SUPPLIED body does not satisfy the published contract.
     */
    private optionalRequest<S extends z.ZodType>(operation: string, schema: S, body: unknown): z.output<S> | undefined {
        return body === undefined ? undefined : this.request(operation, schema, body);
    }

    /** Like {@link expect}, for a no-content (`204`/void) success — throws the typed error otherwise. */
    private expectNoContent(res: RawResponse, status: number): void {
        if (res.status === status) {
            return;
        }

        throw this.toError(res);
    }

    /**
     * Map a non-success response to its typed error.
     *
     * ── TWO LAYERS, AND BOTH ARE LOAD-BEARING ──
     *
     * 1. **`recipeApiErrorSchema` — the published discriminated union — decides the error, keyed on `code`.**
     *    The `switch` in {@link errorForCode} is EXHAUSTIVE over the published codes, so a code the service adds
     *    is a `typecheck` failure in this file rather than a silent fall-through at runtime.
     * 2. **`apiErrorSchema` then the STATUS, for anything the union does not recognise.** A body may
     *    legitimately be an envelope carrying a code this build has never been taught (a deployed service adds
     *    codes ahead of a released mobile binary), or not our envelope at all — the shared internet-facing ALB
     *    serves an HTML page for `502`/`503`/`504` during every deploy (ADR-0003). Both degrade to "map by
     *    status alone", which {@link errorForStatus} still does correctly.
     *
     * ⚠️ THIS REPLACED AN UNCHECKED CAST, and the `@unparsedBoundary` tag that documented it is GONE. The read
     * was `(res.body ?? {}) as { code?, message?, details? }` because the service published no error envelope, so
     * there was nothing to parse against; it now publishes one. The `409` branch was the sharp edge — it told a
     * `PULL_DRIFT` from a `VERSION_CONFLICT` with a bare string compare on an unvalidated field, and anything
     * that was not the literal fell through to the version-conflict mapping, so a drifted code produced the WRONG
     * typed error rather than a recognisable failure. Both `409`s are now arms of the union.
     *
     * `safeParse` throughout, never `parse`: throwing here would replace a recoverable typed error with a
     * `ZodError` escaping the error-mapping path itself.
     *
     * @param res - The normalized non-success response.
     * @returns The typed error to throw.
     */
    private toError(res: RawResponse): RecipeServiceClientError {
        const known = recipeApiErrorSchema.safeParse(res.body);

        if (known.success) {
            return this.errorForCode(known.data, res);
        }

        const envelope = apiErrorSchema.safeParse(res.body);

        return this.errorForStatus(res, envelope.success ? envelope.data : undefined);
    }

    /**
     * The typed error for a body whose `code` this build knows, narrowed by the published union.
     *
     * Every `details` read here is one the union GUARANTEES for that code, which is why there is no optional
     * chaining and no re-narrowing: `VERSION_CONFLICT` carries `versionConflictDetailsSchema` (composed into the
     * arm, so the 3-way-merge snapshots arrive typed) and `PULL_DRIFT` carries `details.diff`.
     *
     * ⚠️ `details.diff` is the ONE value still narrowed here rather than by the union, and the reason is a real
     * constraint recorded at the schema: generation flattens the authored schemas, so `api-error.schema.ts` cannot
     * import `pullDiffSchema` from `collections.schema.ts` to type it, and re-declaring the diff shape would make
     * a second authority for `PullDiff`. So the arm guarantees `diff` is PRESENT and this parses it with the
     * published `pullDiffSchema` — the same schema the preview response is parsed with.
     *
     * @param body - The narrowed error body.
     * @param res - The normalized response, for the status the un-classed codes keep.
     * @returns The typed error to throw. Pure.
     */
    private errorForCode(body: RecipeApiError, res: RawResponse): RecipeServiceClientError {
        switch (body.code) {
            case 'VERSION_CONFLICT':
                return new VersionConflictError(
                    body.details.currentVersion,
                    body.details.conflictingVersion,
                    body.message,
                    { server: body.details.server, base: body.details.base },
                );
            case 'PULL_DRIFT':
                return toPullDrift(body);
            case 'RECIPE_TOMBSTONED':
            case 'ACCOUNT_ALREADY_ERASED':
                return new GoneError(body.message, body.code);
            case 'RECIPE_NOT_FOUND':
            case 'NOT_FOUND':
                return new NotFoundError(body.message, body.code);
            case 'NOT_OWNER':
            case 'CANNOT_RATE_OWN_RECIPE':
            case 'FORBIDDEN':
                return new ForbiddenError(body.message, body.code);
            case 'UNAUTHORIZED':
            case 'IDENTITY_SYNC_PENDING':
                return new UnauthorizedError(body.message, body.code);
            case 'VALIDATION_FAILED':
            case 'INVALID_VISIBILITY':
            case 'COLLECTION_NOT_CLONED':
            case 'UNKNOWN_INGREDIENT':
                return new BadRequestError(body.message, body.code);
            // Every remaining code has no dedicated error class, so it keeps the response's OWN status and
            // carries its code for the caller to read. The status is deliberately taken from the response rather
            // than from the service's code→status table: that table is the SERVICE's, this client must not
            // re-declare it, and importing the service package to reach it would drag NestJS and drizzle into
            // web and mobile (ADR-0014, rejected alternative 2).
            //
            // Listing them EXPLICITLY rather than with a `default` is what makes the exhaustiveness gate below
            // reachable — a `default` would silently absorb a newly published code, which is the whole failure
            // this gate exists to prevent.
            case 'MAX_PHOTOS_EXCEEDED':
            case 'ARCHIVE_PENDING':
            case 'COLLECTION_LIMIT_REACHED':
            case 'PHOTO_PROCESSING_FAILED':
            case 'ARCHIVE_DLQ':
            case 'ERASURE_IN_PROGRESS':
            case 'PAYLOAD_TOO_LARGE':
            case 'UNSUPPORTED_MEDIA_TYPE':
            case 'TOO_MANY_REQUESTS':
            case 'NOT_READY':
            case 'INTERNAL_ERROR':
                return new UnexpectedResponseError(res.status, body.message, body.code);

            default: {
                // EXHAUSTIVENESS GATE (§15.1: drift must fail at `typecheck`, not in e2e). Adding a code to the
                // service's `recipeErrorCodeSchema` breaks this line until this client decides what it means —
                // and an OLDER client, which cannot have the arm, still degrades correctly because `safeParse`
                // rejects the unknown code before it ever gets here.
                const unhandled: never = body;

                return new UnexpectedResponseError(500, (unhandled as { message?: string }).message);
            }
        }
    }

    /**
     * The typed error for a body this build cannot narrow — an unknown code, or not our envelope at all.
     *
     * This is the ONLY place status still decides, and it must stay: it is the correct degradation for a service
     * deployed ahead of this binary, and for the ALB's HTML error page.
     *
     * @param res - The normalized non-success response.
     * @param envelope - The permissively-parsed envelope, when the body was at least that.
     * @returns The typed error to throw. Pure.
     */
    private errorForStatus(res: RawResponse, envelope: ApiErrorBody | undefined): RecipeServiceClientError {
        const message = envelope?.message;
        const code = envelope?.code;

        switch (res.status) {
            case 400:
                return new BadRequestError(message, code);
            case 401:
                return new UnauthorizedError(message, code);
            case 403:
                return new ForbiddenError(message, code);
            case 404:
                return new NotFoundError(message, code);
            // A `409` this build cannot narrow keeps falling through to the version-conflict mapping, which is
            // the pre-convergence behaviour and remains the right guess: `VERSION_CONFLICT` is the only `409`
            // whose typed error carries data a caller acts on, and `toVersionConflict` tolerates a body with no
            // usable `details` by leaving the version numbers undefined.
            case 409:
                return toVersionConflict({ message, details: envelope?.details });
            case 410:
                return new GoneError(message, code);
            default:
                return new UnexpectedResponseError(res.status, message, code);
        }
    }
}

/**
 * True when a normalized response is the first-token sync-race `401` (`code: IDENTITY_SYNC_PENDING`).
 *
 * The body is PARSED against the published envelope rather than cast. The `@unparsedBoundary` tag that used to
 * sit here is gone: it recorded that the service published no error envelope, so there was no zod for this
 * `{ code }` read and authoring some here would have made the client a rival authority on a shape the service
 * owns. The service now publishes `apiErrorSchema`, so this parses.
 *
 * Two properties are kept deliberately. The comparison is still against `IDENTITY_SYNC_PENDING_CODE` — the ONE
 * published constant — rather than a local literal, so the retry trigger cannot drift from what the auth
 * middleware emits. And the check is still fail-CLOSED: a body that is not the envelope, or carries any other
 * code, yields `false` and the retry loop does not start, so a malformed `401` can never become an infinite
 * refresh-and-retry.
 */
function isIdentitySyncPending(res: RawResponse): boolean {
    if (res.status !== 401) {
        return false;
    }

    const envelope = apiErrorSchema.safeParse(res.body);

    return envelope.success && envelope.data.code === IDENTITY_SYNC_PENDING_CODE;
}

/**
 * Build a {@link VersionConflictError} from an `ErrorResponse` body, extracting the version `details`. When
 * the body carries the enriched W8-a.5 shape (server + optional base snapshots), those are parsed via
 * `versionConflictDetailsSchema` and attached so the conflict UI can 3-way merge without re-fetching; a bare
 * `{ currentVersion, conflictingVersion }` body still yields the numbers with `server`/`base` left undefined.
 */
function toVersionConflict(body: { message?: string; details?: Record<string, unknown> }): VersionConflictError {
    const details: Record<string, unknown> = body.details ?? {};
    const current = details['currentVersion'];
    const conflicting = details['conflictingVersion'];

    const enriched = versionConflictDetailsSchema.safeParse(details);

    return new VersionConflictError(
        typeof current === 'number' ? current : undefined,
        typeof conflicting === 'number' ? conflicting : undefined,
        body.message,
        enriched.success ? { server: enriched.data.server, base: enriched.data.base } : undefined,
    );
}

/**
 * Build a {@link PullDriftError} from a `PULL_DRIFT` `ErrorResponse` body, extracting + validating the
 * fresh diff carried at `details.diff` (`pullDriftError` in the recipe service). Falls back to an
 * empty-but-well-formed {@link PullDiff} on a malformed/absent `details.diff` — defensive parsing
 * symmetric with {@link toVersionConflict}'s `safeParse` — so a body drifted from the documented shape
 * still yields a typed, `diff`-carrying error rather than throwing out of the error-mapping path itself.
 */
function toPullDrift(body: { message?: string; details?: Record<string, unknown> }): PullDriftError {
    const parsed = pullDiffSchema.safeParse(body.details?.['diff']);
    const diff: PullDiff = parsed.success ? parsed.data : { added: [], removed: [], unchanged: [] };

    return new PullDriftError(diff, body.message);
}
