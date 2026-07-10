/**
 * `@kitchensink/recipe-service-client` (T-004 / T-095) — the typed client for the Commise recipe
 * management API (`/v1/recipes`, `/v1/ingredients`, `/v1/collections`, `/v1/search`, `/v1/account`).
 * Attaches a user-session or M2M bearer token and maps the recipe service's HTTP contract to typed
 * results (DTOs from `@kitchensink/recipe-core` + local wire envelopes) and typed errors
 * (`400`/`401`/`403`/`404`/`409`/`410`). Named-only barrel (CODING_STANDARDS).
 *
 * TanStack Query hooks live on the `./hooks` subpath (`@kitchensink/recipe-service-client/hooks`) so a
 * non-React consumer of the plain client never pulls React in.
 */
export { RecipeServiceClient } from './client.js';
export type { RecipeServiceClientOptions, TokenSource } from './client.js';

export {
    BadRequestError,
    ForbiddenError,
    GoneError,
    NotFoundError,
    RecipeServiceClientError,
    UnauthorizedError,
    UnexpectedResponseError,
    VersionConflictError,
    isBadRequestError,
    isForbiddenError,
    isGoneError,
    isNotFoundError,
    isRecipeServiceClientError,
    isUnauthorizedError,
    isUnexpectedResponseError,
    isVersionConflictError,
} from './errors.js';

export type {
    CloneCollectionRequest,
    CollectionRecipeAddedVia,
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
    RecipeListSortBy,
    RecipeSearchFacetCounts,
    RecipeSearchFacets,
    RecipeSearchResponse,
    UpdateCollectionRequest,
    UploadUrlResponse,
} from './types.js';

// Canonical domain contracts owned by `@kitchensink/recipe-core`, re-exported so the client's public
// surface stays complete for consumers that import them from this barrel (`RecipeSearchResult` is the
// object-per-hit envelope in `RecipeSearchResponse.results`).
export type { RecipeFacetCount, RecipeSearchResult, RestoreVersionResponse } from '@kitchensink/recipe-core';
