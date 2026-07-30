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
export { DEFAULT_REQUEST_TIMEOUT_MS, RecipeServiceClient } from './client.js';
export type { RecipeServiceClientOptions, TokenSource } from './client.js';

// P5 (W9) — the `queryOptions` repository-read-seam factories + the recipe-write invalidation registry.
// Per the task contract these are exported from the main barrel (not the React-only `./hooks` subpath),
// on the reasoning that a `queryOptions` VALUE needs no React to construct or consume (e.g. a server-side
// `queryClient.prefetchQuery`/`fetchQuery` caller). Residual note: `queries.ts` still imports
// `queryOptions`/`infiniteQueryOptions` from `@tanstack/react-query` (the only package that exports them
// in v5) rather than the React-free `@tanstack/query-core`, so loading THIS barrel now also loads
// `@tanstack/react-query`'s module graph — which is already a hard `dependencies` entry (not an optional
// peer) of this package, and `react` itself is already a mandatory `peerDependencies` entry for the whole
// package, so this does not add a new dependency, only widens which entry point pulls in one that already
// existed. `hooks.ts` (the `./hooks` subpath) is what actually calls `useQuery`/`useInfiniteQuery` on top
// of the values these factories build.
export { collectionQueries, ingredientQueries, recipeProjections, recipeQueries } from './queries.js';

export {
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
    isBadRequestError,
    isFetchUnavailableError,
    isForbiddenError,
    isGoneError,
    isNotFoundError,
    isPullDriftError,
    isRecipeServiceClientError,
    isUnauthorizedError,
    isUnexpectedResponseError,
    isVersionConflictError,
} from './errors.js';

export type {
    AddIngredientByFoodRequest,
    CloneCollectionRequest,
    Collection,
    CollectionMemberRecipe,
    CollectionRecipeAddedVia,
    CollectionRecipeMembership,
    CollectionWithRecipes,
    CreateCollectionRequest,
    ErasureRequest,
    ErasureRequestAcceptedResponse,
    IngredientCandidate,
    IngredientCatalogAvailability,
    IngredientSuggestion,
    IngredientSuggestionProvenance,
    IngredientSuggestions,
    ListCollectionsParams,
    ListRecipesParams,
    PhotoConfirmRequest,
    PhotoUploadUrlRequest,
    PullDiff,
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
export type {
    RecipeDetail,
    RecipeFacetCount,
    RecipeIngredientView,
    RecipeSearchResult,
    RecipeStepView,
    RestoreVersionResponse,
} from '@kitchensink/recipe-core';
