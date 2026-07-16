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
 * - **Base URL injected (never hardcoded).** The consumer reads its platform env var
 *   (`NEXT_PUBLIC_API_BASE_URL` on web, `EXPO_PUBLIC_API_URL` on mobile) and injects it, exactly like
 *   `FoodServiceClient`.
 */
import { IDENTITY_SYNC_PENDING_CODE } from '@kitchensink/recipe-core';
import type {
    Collection,
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
import ky, { HTTPError } from 'ky';
import type { KyInstance, Options } from 'ky';

import {
    BadRequestError,
    ForbiddenError,
    GoneError,
    NotFoundError,
    RecipeServiceClientError,
    UnauthorizedError,
    UnexpectedResponseError,
    VersionConflictError,
} from './errors.js';
import type {
    CloneCollectionRequest,
    CollectionRecipeMembership,
    CollectionWithRecipes,
    CreateCollectionRequest,
    ErasureRequest,
    ErasureRequestAcceptedResponse,
    IngredientCandidate,
    ListCollectionsParams,
    ListRecipesParams,
    PhotoConfirmRequest,
    PhotoUploadUrlRequest,
    PullFromSourceResponse,
    RecipeSearchResponse,
    UpdateCollectionRequest,
    UploadUrlResponse,
} from './types.js';

/**
 * A bearer token supplied either as a literal or a (sync/async) per-request callback. The callback
 * receives `{ forceRefresh }` — `true` when the client is retrying the first-token sync race and needs a
 * freshly-minted token (the app wires this to Clerk's `getToken({ skipCache: true })`). A callback that
 * ignores the argument still works — it simply returns its (possibly cached) token.
 */
export type TokenSource = string | ((options?: { readonly forceRefresh?: boolean }) => string | Promise<string>);

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

/**
 * Normalize a `fetch`/ky {@link Response} (a success response, or the one carried by a thrown
 * {@link HTTPError}) into a {@link RawResponse}: its status plus the parsed JSON body, or an `undefined`
 * body for an empty/`204` response.
 *
 * @sideEffect Reads (consumes) the response body stream.
 */
async function normalizeResponse(response: Response): Promise<RawResponse> {
    const text = await response.text();

    return { status: response.status, body: text.length > 0 ? JSON.parse(text) : undefined };
}

export class RecipeServiceClient {
    private readonly baseUrl: string;
    private readonly token: TokenSource | undefined;
    private readonly maxIdentitySyncRetries: number;
    private readonly identitySyncBackoffMs: readonly number[];
    private readonly sleep: (ms: number) => Promise<void>;
    /** The configured ky transport: base URL, token attach, JSON body/parse, and typed error throwing. */
    private readonly http: KyInstance;

    /** @param options - Base URL, optional token, an optional `fetch` double, and identity-sync retry config. */
    public constructor(options: RecipeServiceClientOptions) {
        this.baseUrl = options.baseUrl.replace(/\/+$/, '');
        this.token = options.token;
        this.maxIdentitySyncRetries = options.maxIdentitySyncRetries ?? 3;
        this.identitySyncBackoffMs = options.identitySyncBackoffMs ?? [250, 500, 1000];
        this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
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
            // no other status is retried — so ky's own retry/timeout are disabled to preserve behavior.
            retry: 0,
            timeout: false,
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

        if (res.status === 201) {
            return res.body as RecipeDetail;
        }

        throw this.toError(res);
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

        if (res.status === 200) {
            return res.body as PaginatedResponse<Recipe>;
        }

        throw this.toError(res);
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

        if (res.status === 200) {
            return res.body as RecipeDetail;
        }

        throw this.toError(res);
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

        if (res.status === 200) {
            return res.body as RecipeDetail;
        }

        throw this.toError(res);
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

        if (res.status === 204) {
            return;
        }

        throw this.toError(res);
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

        if (res.status === 201) {
            return res.body as RecipeDetail;
        }

        throw this.toError(res);
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

        if (res.status === 200) {
            return res.body as RecipeDetail;
        }

        throw this.toError(res);
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

        if (res.status === 200) {
            return res.body as RecipeDetail;
        }

        throw this.toError(res);
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

        if (res.status === 204) {
            return;
        }

        throw this.toError(res);
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

        if (res.status === 200) {
            return res.body as readonly Ingredient[];
        }

        throw this.toError(res);
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

        if (res.status === 201) {
            return res.body as Ingredient;
        }

        throw this.toError(res);
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

        if (res.status === 202) {
            return res.body as Ingredient;
        }

        throw this.toError(res);
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

        if (res.status === 200) {
            return res.body as Ingredient;
        }

        throw this.toError(res);
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

        if (res.status === 200) {
            return res.body as readonly IngredientCandidate[];
        }

        throw this.toError(res);
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

        if (res.status === 200) {
            return res.body as Ingredient;
        }

        throw this.toError(res);
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

        if (res.status === 200) {
            return res.body as readonly RecipeVersion[];
        }

        throw this.toError(res);
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

        if (res.status === 200) {
            return res.body as RecipeVersion;
        }

        throw this.toError(res);
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

        if (res.status === 200) {
            return res.body as RestoreVersionResponse;
        }

        throw this.toError(res);
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

        if (res.status === 200) {
            return res.body as UploadUrlResponse;
        }

        throw this.toError(res);
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

        if (res.status === 201) {
            return res.body as RecipePhoto;
        }

        throw this.toError(res);
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

        if (res.status === 200) {
            return res.body as readonly RecipePhoto[];
        }

        throw this.toError(res);
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

        if (res.status === 204) {
            return;
        }

        throw this.toError(res);
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

        if (res.status === 200) {
            return res.body as readonly RecipePhoto[];
        }

        throw this.toError(res);
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

        if (res.status === 201) {
            return res.body as Collection;
        }

        throw this.toError(res);
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

        if (res.status === 200) {
            return res.body as PaginatedResponse<Collection>;
        }

        throw this.toError(res);
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

        if (res.status === 200) {
            return res.body as CollectionWithRecipes;
        }

        throw this.toError(res);
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

        if (res.status === 200) {
            return res.body as Collection;
        }

        throw this.toError(res);
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

        if (res.status === 204) {
            return;
        }

        throw this.toError(res);
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

        if (res.status === 201) {
            return res.body as CollectionRecipeMembership;
        }

        throw this.toError(res);
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

        if (res.status === 204) {
            return;
        }

        throw this.toError(res);
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

        if (res.status === 201) {
            return res.body as Collection;
        }

        throw this.toError(res);
    }

    /**
     * `POST /v1/collections/{id}/pull-from-source` — pull new recipes from a cloned collection's source.
     *
     * @param id - The (cloned) collection id.
     * @returns The resulting collection + the recipe ids this pull added.
     * @throws {BadRequestError} (`COLLECTION_NOT_CLONED`) when the collection has no source to pull from.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async pullCollectionFromSource(id: string): Promise<PullFromSourceResponse> {
        const res = await this.send('POST', `/v1/collections/${encodeURIComponent(id)}/pull-from-source`);

        if (res.status === 200) {
            return res.body as PullFromSourceResponse;
        }

        throw this.toError(res);
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
            maxTotalTime: params.maxTotalTime,
            ingredientIds: params.ingredientIds,
            page: params.page,
            pageSize: params.pageSize,
            sortBy: params.sortBy,
        });

        if (res.status === 200) {
            return res.body as RecipeSearchResponse;
        }

        throw this.toError(res);
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

        if (res.status === 202) {
            return res.body as ErasureRequestAcceptedResponse;
        }

        throw this.toError(res);
    }

    // ─── Transport ──────────────────────────────────────────────────────────────────────────────

    /**
     * Issue an authenticated request and normalize the response (status + parsed body), retrying the
     * first-token sync race (`401` `IDENTITY_SYNC_PENDING`) with a force-refreshed token per the configured
     * backoff. No other status is retried.
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
                return toVersionConflict(body);
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

/** Build a {@link VersionConflictError} from an `ErrorResponse` body, extracting the version `details`. */
function toVersionConflict(body: { message?: string; details?: Record<string, unknown> }): VersionConflictError {
    const details: Record<string, unknown> = body.details ?? {};
    const current = details['currentVersion'];
    const conflicting = details['conflictingVersion'];

    return new VersionConflictError(
        typeof current === 'number' ? current : undefined,
        typeof conflicting === 'number' ? conflicting : undefined,
        body.message,
    );
}
