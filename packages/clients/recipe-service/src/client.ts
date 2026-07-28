/**
 * `RecipeServiceClient` (T-004 / T-095) — the typed client for the Commise recipe management API
 * (`/v1/recipes`, `/v1/ingredients`, `/v1/collections`, `/v1/search`, `/v1/account`). It is the single
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
    collectionSchema,
    ingredientSchema,
    paginatedResponseSchema,
    recipeDetailSchema,
    recipePhotoSchema,
    recipeSchema,
    recipeVersionSchema,
    restoreVersionResponseSchema,
    versionConflictDetailsSchema,
} from '@kitchensink/recipe-core';
import { z } from 'zod';
import type {
    CreateRecipeInput,
    Ingredient,
    PaginatedResponse,
    Recipe,
    RecipeDetail,
    RecipePhoto,
    RecipeSearchParams,
    RecipeVersion,
    RecipeVisibility,
    RestoreVersionResponse,
    SetRecipeRatingInput,
    UpdateRecipeInput,
} from '@kitchensink/recipe-core';
import ky, { HTTPError, TimeoutError } from 'ky';
import type { KyInstance, Options } from 'ky';

import {
    BadRequestError,
    FetchUnavailableError,
    ForbiddenError,
    GoneError,
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

/**
 * The `Collection` response schema, WIDENED (W5 Task 5) from `@kitchensink/recipe-core`'s `collectionSchema`
 * with the recipe service's response-only pull-provenance fields (`./types.js`'s local `Collection`). This
 * MUST stay in sync with that widening: `collectionSchema.parse` alone would silently STRIP these fields
 * (zod drops unrecognized keys by default), so every validated collection-returning method below uses this
 * extended schema, never the bare core one — otherwise the wider TS type would be a lie about what `parse`
 * actually returns. `lastPulledAt` reuses the same `.datetime({ offset: true })` strictness as the core
 * schema's own timestamp fields (its private `isoDateTimeStringSchema` is not exported for reuse here).
 */
const collectionResponseSchema = collectionSchema.extend({
    sourceOwnerHandle: z.string().min(1).optional(),
    sourceCollectionName: z.string().min(1).optional(),
    lastPulledAt: z.string().datetime({ offset: true }).optional(),
});

/** Runtime validator for {@link PullDiff} — the response shape of `previewPullFromSource`. */
const pullDiffSchema = z.object({
    added: z.array(z.string()),
    removed: z.array(z.string()),
    unchanged: z.array(z.string()),
});

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
}

/** A normalized response: status and parsed JSON body (or `undefined` for empty/`204`). */
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

    /** @param options - Base URL, optional token, an optional `fetch` double, and identity-sync retry config. */
    public constructor(options: RecipeServiceClientOptions) {
        this.baseUrl = options.baseUrl.replace(/\/+$/, '');
        this.token = options.token;
        this.maxIdentitySyncRetries = options.maxIdentitySyncRetries ?? 3;
        this.identitySyncBackoffMs = options.identitySyncBackoffMs ?? [250, 500, 1000];
        this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
        this.timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
        this.http = ky.create({
            // ky appends the single joining slash; input paths are passed without a leading slash.
            prefixUrl: this.baseUrl,
            // The injected `fetch` (a test double) is used as-is; otherwise the platform global, bound to
            // `globalThis`. A BARE `fetch` reference handed to ky is invoked detached, which throws
            // `TypeError: Illegal invocation` in the browser (window.fetch must be called with `window` as
            // its receiver) — breaking every real browser request. Binding fixes it on web and is a no-op
            // in Node/RN. (Test doubles are plain functions and need no binding.)
            fetch: options.fetch ?? globalThis.fetch.bind(globalThis),
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
     * `POST /v1/recipes` — create a recipe (`201`).
     *
     * @param input - The recipe draft.
     * @returns The created recipe.
     * @throws {BadRequestError} on validation failure; {@link UnauthorizedError} on auth failure.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async createRecipe(input: CreateRecipeInput): Promise<RecipeDetail> {
        const res = await this.send('POST', '/v1/recipes', input);

        return this.expect(res, 201, recipeDetailSchema);
    }

    /**
     * `GET /v1/recipes` — list the caller's recipes (paginated).
     *
     * @param params - Pagination + sort.
     * @returns A paginated page of recipes.
     * @throws {UnauthorizedError} on auth failure.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async listRecipes(params: ListRecipesParams = {}): Promise<PaginatedResponse<Recipe>> {
        const res = await this.send('GET', '/v1/recipes', undefined, {
            page: params.page,
            pageSize: params.pageSize,
            sortBy: params.sortBy,
        });

        return this.expect(res, 200, paginatedResponseSchema(recipeSchema));
    }

    /**
     * `GET /v1/recipes/{id}` — read a recipe by id.
     *
     * @param id - The recipe id.
     * @returns The recipe.
     * @throws {NotFoundError} when absent/tombstoned; {@link ForbiddenError} when not the owner.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async getRecipeById(id: string): Promise<RecipeDetail> {
        const res = await this.send('GET', `/v1/recipes/${encodeURIComponent(id)}`);

        return this.expect(res, 200, recipeDetailSchema);
    }

    /**
     * `PATCH /v1/recipes/{id}` — update a recipe with optimistic concurrency.
     *
     * @param id - The recipe id.
     * @param input - The partial update carrying the caller's `expectedVersion`.
     * @returns The updated recipe.
     * @throws {VersionConflictError} on a stale `expectedVersion`; {@link ForbiddenError} when not owner.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async updateRecipe(id: string, input: UpdateRecipeInput): Promise<RecipeDetail> {
        const res = await this.send('PATCH', `/v1/recipes/${encodeURIComponent(id)}`, input);

        return this.expect(res, 200, recipeDetailSchema);
    }

    /**
     * `DELETE /v1/recipes/{id}` — soft-delete (tombstone) a recipe (`204`).
     *
     * @param id - The recipe id.
     * @throws {ForbiddenError} when not the owner; {@link NotFoundError} when absent.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async deleteRecipe(id: string): Promise<void> {
        const res = await this.send('DELETE', `/v1/recipes/${encodeURIComponent(id)}`);

        return this.expectNoContent(res, 204);
    }

    /**
     * `POST /v1/recipes/{id}/clone` — clone a public recipe into the caller's library (`201`).
     *
     * @param id - The source recipe id.
     * @returns The newly created clone.
     * @throws {ForbiddenError} when the source is not clonable; {@link NotFoundError} when absent.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async cloneRecipe(id: string): Promise<RecipeDetail> {
        const res = await this.send('POST', `/v1/recipes/${encodeURIComponent(id)}/clone`);

        return this.expect(res, 201, recipeDetailSchema);
    }

    /**
     * `PATCH /v1/recipes/{id}/visibility` — set a recipe's visibility.
     *
     * @param id - The recipe id.
     * @param visibility - The new visibility.
     * @returns The updated recipe.
     * @throws {ForbiddenError} when not the owner; {@link BadRequestError} on an invalid value.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async setRecipeVisibility(id: string, visibility: RecipeVisibility): Promise<RecipeDetail> {
        const res = await this.send('PATCH', `/v1/recipes/${encodeURIComponent(id)}/visibility`, { visibility });

        return this.expect(res, 200, recipeDetailSchema);
    }

    /**
     * `PUT /v1/recipes/{id}/rating` — set the caller's rating of a recipe (idempotent upsert, FR-013).
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
    public async setRecipeRating(id: string, input: SetRecipeRatingInput): Promise<RecipeDetail> {
        const res = await this.send('PUT', `/v1/recipes/${encodeURIComponent(id)}/rating`, input);

        return this.expect(res, 200, recipeDetailSchema);
    }

    /**
     * `DELETE /v1/recipes/{id}/rating` — remove the caller's rating of a recipe (`204`, FR-013).
     *
     * Idempotent: removing a rating that does not exist still succeeds with `204`.
     *
     * @param id - The recipe id.
     * @throws {NotFoundError} when the recipe is absent OR not visible to the caller.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async deleteRecipeRating(id: string): Promise<void> {
        const res = await this.send('DELETE', `/v1/recipes/${encodeURIComponent(id)}/rating`);

        return this.expectNoContent(res, 204);
    }

    // ─── Ingredients ────────────────────────────────────────────────────────────────────────────

    /**
     * `GET /v1/ingredients/search` — typeahead ingredient search (thin proxy over the food service).
     *
     * @param query - The name query.
     * @param limit - Max results (1–50; server default 10).
     * @returns Matching ingredients (nutrition resolves asynchronously; see `foodResolutionStatus`).
     * @throws {UnauthorizedError} on auth failure.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async searchIngredients(query: string, limit?: number): Promise<readonly Ingredient[]> {
        const res = await this.send('GET', '/v1/ingredients/search', undefined, { q: query, limit });

        return this.expect(res, 200, z.array(ingredientSchema));
    }

    /**
     * `GET /v1/ingredients/suggest` — the BLENDED ingredient typeahead (search Stage 2): the recipe-service
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
        const res = await this.send('GET', '/v1/ingredients/suggest', undefined, { q: query, limit });

        return this.expectUnvalidated<IngredientSuggestions>(res, 200);
    }

    /**
     * `POST /v1/ingredients/by-food` — admit a `catalog` suggestion as a food-backed ingredient (`200`).
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
        const res = await this.send('POST', '/v1/ingredients/by-food', { foodId });

        return this.expect(res, 200, ingredientSchema);
    }

    /**
     * `POST /v1/ingredients` — create a freeform ingredient (`201`).
     *
     * @param name - The ingredient name.
     * @returns The created ingredient.
     * @throws {BadRequestError} on an empty/oversized name; {@link UnauthorizedError} on auth failure.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async createIngredient(name: string): Promise<Ingredient> {
        const res = await this.send('POST', '/v1/ingredients', { name });

        return this.expect(res, 201, ingredientSchema);
    }

    /**
     * `POST /v1/ingredients/by-name` — add an unknown food by name through the source-agnostic food service
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
        const res = await this.send('POST', '/v1/ingredients/by-name', { name });

        return this.expect(res, 202, ingredientSchema);
    }

    /**
     * `GET /v1/ingredients/{id}/status` — poll a food-backed ingredient's async resolution (data-model R5).
     *
     * The server re-reads the food service, persists the current status (and golden-record nutrition once
     * `RESOLVED`), and returns the refreshed ingredient. Poll while `foodResolutionStatus` is `PENDING`;
     * stop on any terminal/resolved/unresolved state (see {@link useIngredientStatus}).
     *
     * @param id - The ingredient id.
     * @returns The refreshed ingredient with its current resolution status.
     * @throws {NotFoundError} when the ingredient is absent; {@link UnauthorizedError} on auth failure.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async getIngredientStatus(id: string): Promise<Ingredient> {
        const res = await this.send('GET', `/v1/ingredients/${encodeURIComponent(id)}/status`);

        return this.expect(res, 200, ingredientSchema);
    }

    /**
     * `GET /v1/ingredients/{id}/candidates` — the disambiguation candidate set for an `UNRESOLVED` ingredient.
     *
     * @param id - The ingredient id.
     * @returns The candidate foods to pick from (empty for a freeform or non-`UNRESOLVED` ingredient).
     * @throws {NotFoundError} when the ingredient is absent; {@link UnauthorizedError} on auth failure.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async getIngredientCandidates(id: string): Promise<readonly IngredientCandidate[]> {
        const res = await this.send('GET', `/v1/ingredients/${encodeURIComponent(id)}/candidates`);

        return this.expectUnvalidated<readonly IngredientCandidate[]>(res, 200);
    }

    /**
     * `POST /v1/ingredients/{id}/resolve` — resolve an `UNRESOLVED` ingredient from a candidate pick (`200`).
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
        const res = await this.send('POST', `/v1/ingredients/${encodeURIComponent(id)}/resolve`, { candidateIds });

        return this.expect(res, 200, ingredientSchema);
    }

    // ─── Versions ───────────────────────────────────────────────────────────────────────────────

    /**
     * `GET /v1/recipes/{id}/versions` — list a recipe's recent versions (up to 10).
     *
     * @param id - The recipe id.
     * @returns The version list.
     * @throws {ForbiddenError} when not the owner; {@link NotFoundError} when absent.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async listRecipeVersions(id: string): Promise<readonly RecipeVersion[]> {
        const res = await this.send('GET', `/v1/recipes/${encodeURIComponent(id)}/versions`);

        return this.expect(res, 200, z.array(recipeVersionSchema));
    }

    /**
     * `GET /v1/recipes/{id}/versions/{versionNumber}` — read a specific version snapshot.
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
            `/v1/recipes/${encodeURIComponent(id)}/versions/${encodeURIComponent(String(versionNumber))}`,
        );

        return this.expect(res, 200, recipeVersionSchema);
    }

    /**
     * `POST /v1/recipes/{id}/versions/{versionNumber}/restore` — restore a recipe to a prior version.
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
            `/v1/recipes/${encodeURIComponent(id)}/versions/${encodeURIComponent(String(versionNumber))}/restore`,
        );

        return this.expect(res, 200, restoreVersionResponseSchema);
    }

    // ─── Photos ─────────────────────────────────────────────────────────────────────────────────

    /**
     * `POST /v1/recipes/{id}/photos/upload-url` — mint a presigned S3 URL for a direct client upload.
     *
     * @param id - The recipe id.
     * @param request - File name, content type, and size (≤ 5 MiB).
     * @returns The presigned upload URL + object key.
     * @throws {ForbiddenError} when not the owner; {@link NotFoundError} when the recipe is absent.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async createPhotoUploadUrl(id: string, request: PhotoUploadUrlRequest): Promise<UploadUrlResponse> {
        const res = await this.send('POST', `/v1/recipes/${encodeURIComponent(id)}/photos/upload-url`, request);

        return this.expectUnvalidated<UploadUrlResponse>(res, 200);
    }

    /**
     * `POST /v1/recipes/{id}/photos/confirm` — associate an uploaded object key with the recipe (`201`).
     *
     * @param id - The recipe id.
     * @param request - The uploaded object key + content type.
     * @returns The created photo record.
     * @throws {BadRequestError} when the max photo count is exceeded; {@link ForbiddenError} when not owner.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async confirmPhotoUpload(id: string, request: PhotoConfirmRequest): Promise<RecipePhoto> {
        const res = await this.send('POST', `/v1/recipes/${encodeURIComponent(id)}/photos/confirm`, request);

        return this.expect(res, 201, recipePhotoSchema);
    }

    /**
     * `GET /v1/recipes/{id}/photos` — list a recipe's photos.
     *
     * @param id - The recipe id.
     * @returns The photos, in display order.
     * @throws {NotFoundError} when the recipe is absent.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async listRecipePhotos(id: string): Promise<readonly RecipePhoto[]> {
        const res = await this.send('GET', `/v1/recipes/${encodeURIComponent(id)}/photos`);

        return this.expect(res, 200, z.array(recipePhotoSchema));
    }

    /**
     * `DELETE /v1/recipes/{id}/photos/{photoId}` — delete a photo (`204`).
     *
     * @param id - The recipe id.
     * @param photoId - The photo id.
     * @throws {ForbiddenError} when not the owner; {@link NotFoundError} when absent.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async deleteRecipePhoto(id: string, photoId: string): Promise<void> {
        const res = await this.send(
            'DELETE',
            `/v1/recipes/${encodeURIComponent(id)}/photos/${encodeURIComponent(photoId)}`,
        );

        return this.expectNoContent(res, 204);
    }

    /**
     * `PATCH /v1/recipes/{id}/photos/reorder` — set the final display order of a recipe's photos.
     *
     * @param id - The recipe id.
     * @param photoIds - The photo ids in the desired order (1–10).
     * @returns The reordered photos.
     * @throws {ForbiddenError} when not the owner; {@link NotFoundError} when absent.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async reorderRecipePhotos(id: string, photoIds: readonly string[]): Promise<readonly RecipePhoto[]> {
        const res = await this.send('PATCH', `/v1/recipes/${encodeURIComponent(id)}/photos/reorder`, { photoIds });

        return this.expect(res, 200, z.array(recipePhotoSchema));
    }

    // ─── Collections ────────────────────────────────────────────────────────────────────────────

    /**
     * `POST /v1/collections` — create a collection (`201`).
     *
     * @param request - Name + optional description/visibility.
     * @returns The created collection.
     * @throws {BadRequestError} on validation failure; {@link UnauthorizedError} on auth failure.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async createCollection(request: CreateCollectionRequest): Promise<Collection> {
        const res = await this.send('POST', '/v1/collections', request);

        return this.expect(res, 201, collectionResponseSchema);
    }

    /**
     * `GET /v1/collections` — list the caller's collections (paginated).
     *
     * @param params - Pagination.
     * @returns A paginated page of collections.
     * @throws {UnauthorizedError} on auth failure.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async listCollections(params: ListCollectionsParams = {}): Promise<PaginatedResponse<Collection>> {
        const res = await this.send('GET', '/v1/collections', undefined, {
            page: params.page,
            pageSize: params.pageSize,
        });

        return this.expect(res, 200, paginatedResponseSchema(collectionResponseSchema));
    }

    /**
     * `GET /v1/collections/{id}` — read a collection with its member recipes.
     *
     * @param id - The collection id.
     * @returns The collection + recipes.
     * @throws {ForbiddenError} when not the owner; {@link NotFoundError} when absent.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async getCollectionById(id: string): Promise<CollectionWithRecipes> {
        const res = await this.send('GET', `/v1/collections/${encodeURIComponent(id)}`);

        return this.expectUnvalidated<CollectionWithRecipes>(res, 200);
    }

    /**
     * `PATCH /v1/collections/{id}` — update a collection.
     *
     * @param id - The collection id.
     * @param request - The partial update (at least one field).
     * @returns The updated collection.
     * @throws {ForbiddenError} when not the owner; {@link BadRequestError} on validation failure.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async updateCollection(id: string, request: UpdateCollectionRequest): Promise<Collection> {
        const res = await this.send('PATCH', `/v1/collections/${encodeURIComponent(id)}`, request);

        return this.expect(res, 200, collectionResponseSchema);
    }

    /**
     * `DELETE /v1/collections/{id}` — delete a collection (`204`).
     *
     * @param id - The collection id.
     * @throws {ForbiddenError} when not the owner; {@link NotFoundError} when absent.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async deleteCollection(id: string): Promise<void> {
        const res = await this.send('DELETE', `/v1/collections/${encodeURIComponent(id)}`);

        return this.expectNoContent(res, 204);
    }

    /**
     * `POST /v1/collections/{id}/recipes` — add a recipe to a collection (`201`).
     *
     * @param id - The collection id.
     * @param recipeId - The recipe to add.
     * @returns The created membership record.
     * @throws {ForbiddenError} when not the owner; {@link NotFoundError} when either is absent.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async addRecipeToCollection(id: string, recipeId: string): Promise<CollectionRecipeMembership> {
        const res = await this.send('POST', `/v1/collections/${encodeURIComponent(id)}/recipes`, { recipeId });

        return this.expectUnvalidated<CollectionRecipeMembership>(res, 201);
    }

    /**
     * `DELETE /v1/collections/{id}/recipes/{recipeId}` — remove a recipe from a collection (`204`).
     *
     * @param id - The collection id.
     * @param recipeId - The recipe to remove.
     * @throws {ForbiddenError} when not the owner; {@link NotFoundError} when absent.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async removeRecipeFromCollection(id: string, recipeId: string): Promise<void> {
        const res = await this.send(
            'DELETE',
            `/v1/collections/${encodeURIComponent(id)}/recipes/${encodeURIComponent(recipeId)}`,
        );

        return this.expectNoContent(res, 204);
    }

    /**
     * `POST /v1/collections/{id}/clone` — clone a collection into the caller's library (`201`).
     *
     * @param id - The source collection id.
     * @param request - Optional name/description overrides.
     * @returns The newly created clone.
     * @throws {ForbiddenError} when the source is not clonable; {@link NotFoundError} when absent.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async cloneCollection(id: string, request?: CloneCollectionRequest): Promise<Collection> {
        const res = await this.send('POST', `/v1/collections/${encodeURIComponent(id)}/clone`, request);

        return this.expect(res, 201, collectionResponseSchema);
    }

    /**
     * `POST /v1/collections/{id}/pull-from-source/preview` — PREVIEW a pull without mutating (W5 Task 5).
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
        const res = await this.send('POST', `/v1/collections/${encodeURIComponent(id)}/pull-from-source/preview`);

        return this.expect(res, 200, pullDiffSchema);
    }

    /**
     * `POST /v1/collections/{id}/pull-from-source` — pull new recipes from a cloned collection's source.
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
        const res = await this.send('POST', `/v1/collections/${encodeURIComponent(id)}/pull-from-source`, body);

        return this.expectUnvalidated<PullFromSourceResponse>(res, 200);
    }

    // ─── Search & account ───────────────────────────────────────────────────────────────────────

    /**
     * `GET /v1/search/recipes` — full-text recipe search with facets.
     *
     * @param params - Query, filters, pagination, and sort.
     * @returns Ranked results + facet counts.
     * @throws {UnauthorizedError} on auth failure.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async searchRecipes(params: RecipeSearchParams = {}): Promise<RecipeSearchResponse> {
        const res = await this.send('GET', '/v1/search/recipes', undefined, {
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

        return this.expectUnvalidated<RecipeSearchResponse>(res, 200);
    }

    /**
     * `POST /v1/account/erasure` — request GDPR account erasure (`202`, idempotent).
     *
     * @param request - Optional confirmation phrase.
     * @returns The (possibly pre-existing) erasure job id + status.
     * @throws {GoneError} (`410`) when the account has already been erased; {@link UnauthorizedError} on auth.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async requestAccountErasure(request?: ErasureRequest): Promise<ErasureRequestAcceptedResponse> {
        const res = await this.send('POST', '/v1/account/erasure', request);

        return this.expectUnvalidated<ErasureRequestAcceptedResponse>(res, 202);
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
     * Like {@link expect}, but for a client-local wire envelope (`./types.js`) that has no
     * `@kitchensink/recipe-core` schema yet — returns the body as `T` unparsed. (Follow-up: give the
     * envelopes client-local zod schemas so these boundaries are parsed too — see DA1 follow-up.)
     */
    private expectUnvalidated<T>(res: RawResponse, status: number): T {
        if (res.status === status) {
            return res.body as T;
        }

        throw this.toError(res);
    }

    /** Like {@link expect}, for a no-content (`204`/void) success — throws the typed error otherwise. */
    private expectNoContent(res: RawResponse, status: number): void {
        if (res.status === status) {
            return;
        }

        throw this.toError(res);
    }

    /** Map a non-success response to the typed error for its status (per the OpenAPI contract). */
    private toError(res: RawResponse): RecipeServiceClientError {
        const body = (res.body ?? {}) as { code?: string; message?: string; details?: Record<string, unknown> };

        switch (res.status) {
            case 400:
                return new BadRequestError(body.message, body.code);
            case 401:
                return new UnauthorizedError(body.message, body.code);
            case 403:
                return new ForbiddenError(body.message, body.code);
            case 404:
                return new NotFoundError(body.message, body.code);
            case 409:
                // Two DISTINCT 409s share this status: an optimistic-concurrency VERSION_CONFLICT (recipe
                // update/restore) and a pull-from-source PULL_DRIFT (commit re-derived a diff that no
                // longer matches the caller's preview). Dispatch on the body's `code` — the ONLY thing that
                // tells them apart — so both keep mapping to their own typed error without regressing the
                // other; anything that is not `PULL_DRIFT` (including a legacy/absent code) falls through
                // to the version-conflict mapping, preserving today's behavior exactly.
                return body.code === 'PULL_DRIFT' ? toPullDrift(body) : toVersionConflict(body);
            case 410:
                return new GoneError(body.message, body.code);
            default:
                return new UnexpectedResponseError(res.status);
        }
    }
}

/** True when a normalized response is the first-token sync-race `401` (`code: IDENTITY_SYNC_PENDING`). */
function isIdentitySyncPending(res: RawResponse): boolean {
    if (res.status !== 401) {
        return false;
    }

    const body = res.body as { code?: unknown } | undefined;

    return body?.code === IDENTITY_SYNC_PENDING_CODE;
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
