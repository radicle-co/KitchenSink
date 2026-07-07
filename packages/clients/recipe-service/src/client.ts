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
import type {
    Collection,
    CreateRecipeInput,
    Ingredient,
    PaginatedResponse,
    Recipe,
    RecipePhoto,
    RecipeSearchParams,
    RecipeVersion,
    RecipeVisibility,
    UpdateRecipeInput,
} from '@kitchensink/recipe-core';

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
    ListCollectionsParams,
    ListRecipesParams,
    PhotoConfirmRequest,
    PhotoUploadUrlRequest,
    PullFromSourceResponse,
    RecipeSearchResponse,
    RestoreVersionResponse,
    UpdateCollectionRequest,
    UploadUrlResponse,
} from './types.js';

/** A bearer token supplied either as a literal or a (sync/async) per-request callback. */
export type TokenSource = string | (() => string | Promise<string>);

/** Construction options. */
export interface RecipeServiceClientOptions {
    /** The recipe API base origin, e.g. `https://api.commise.app` (no trailing `/v1`). */
    readonly baseUrl: string;
    /** A user session or M2M bearer token (literal or per-request callback). */
    readonly token?: TokenSource;
    /** Injectable `fetch` (defaults to the global `fetch`) — enables test doubles. */
    readonly fetch?: typeof fetch;
}

/** A normalized response: status and parsed JSON body (or `undefined` for empty/`204`). */
interface RawResponse {
    readonly status: number;
    readonly body: unknown;
}

/** A JSON-serializable query-parameter bag (scalars, or arrays for repeated params). */
type QueryParams = Record<string, string | number | boolean | readonly string[] | undefined>;

/**
 * Serialize a query-parameter bag to a `?a=1&b=x&b=y` string (arrays → repeated params, matching the
 * OpenAPI `style=form, explode=true`). `undefined`/`null` entries are dropped. Returns `''` when empty.
 */
function toQueryString(params: QueryParams): string {
    const search = new URLSearchParams();

    for (const [key, value] of Object.entries(params)) {
        if (value === undefined) {
            continue;
        }

        if (Array.isArray(value)) {
            for (const item of value) {
                search.append(key, String(item));
            }
        } else {
            search.append(key, String(value as string | number | boolean));
        }
    }

    const query = search.toString();

    return query.length > 0 ? `?${query}` : '';
}

export class RecipeServiceClient {
    private readonly baseUrl: string;
    private readonly token: TokenSource | undefined;
    private readonly fetchImpl: typeof fetch;

    /** @param options - Base URL, optional token (user or M2M), and an optional `fetch` double. */
    public constructor(options: RecipeServiceClientOptions) {
        this.baseUrl = options.baseUrl.replace(/\/+$/, '');
        this.token = options.token;
        this.fetchImpl = options.fetch ?? fetch;
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
    public async createRecipe(input: CreateRecipeInput): Promise<Recipe> {
        const res = await this.send('POST', '/v1/recipes', input);

        if (res.status === 201) {
            return res.body as Recipe;
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
        const query = toQueryString({ page: params.page, pageSize: params.pageSize, sortBy: params.sortBy });
        const res = await this.send('GET', `/v1/recipes${query}`);

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
    public async getRecipeById(id: string): Promise<Recipe> {
        const res = await this.send('GET', `/v1/recipes/${encodeURIComponent(id)}`);

        if (res.status === 200) {
            return res.body as Recipe;
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
    public async updateRecipe(id: string, input: UpdateRecipeInput): Promise<Recipe> {
        const res = await this.send('PATCH', `/v1/recipes/${encodeURIComponent(id)}`, input);

        if (res.status === 200) {
            return res.body as Recipe;
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
    public async cloneRecipe(id: string): Promise<Recipe> {
        const res = await this.send('POST', `/v1/recipes/${encodeURIComponent(id)}/clone`);

        if (res.status === 201) {
            return res.body as Recipe;
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
    public async setRecipeVisibility(id: string, visibility: RecipeVisibility): Promise<Recipe> {
        const res = await this.send('PATCH', `/v1/recipes/${encodeURIComponent(id)}/visibility`, { visibility });

        if (res.status === 200) {
            return res.body as Recipe;
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
        const res = await this.send('GET', `/v1/ingredients/search${toQueryString({ q: query, limit })}`);

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
        const query = toQueryString({ page: params.page, pageSize: params.pageSize });
        const res = await this.send('GET', `/v1/collections${query}`);

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
        const query = toQueryString({
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
        const res = await this.send('GET', `/v1/search/recipes${query}`);

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
     * Issue an authenticated request and normalize the response (status + parsed body).
     *
     * @param method - HTTP method.
     * @param path - Path beginning with `/`.
     * @param body - Optional JSON body.
     * @returns The normalized response.
     * @sideEffect Performs a network request via the injected `fetch`.
     */
    private async send(method: string, path: string, body?: unknown): Promise<RawResponse> {
        const headers: Record<string, string> = { accept: 'application/json' };
        const token = await this.resolveToken();

        if (token) {
            headers['authorization'] = `Bearer ${token}`;
        }

        let payload: string | undefined;

        if (body !== undefined) {
            headers['content-type'] = 'application/json';
            payload = JSON.stringify(body);
        }

        const response = await this.fetchImpl(`${this.baseUrl}${path}`, { method, headers, body: payload });
        const text = await response.text();

        return { status: response.status, body: text.length > 0 ? JSON.parse(text) : undefined };
    }

    /** Resolve the configured token (literal or callback), or `undefined` for an unauthenticated call. */
    private async resolveToken(): Promise<string | undefined> {
        if (this.token === undefined) {
            return undefined;
        }

        return typeof this.token === 'function' ? this.token() : this.token;
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
