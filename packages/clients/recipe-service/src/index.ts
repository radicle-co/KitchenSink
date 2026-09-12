/**
 * `@kitchensink/recipe-service-client` (T-004 / T-095) — the typed client for the Commise recipe
 * management API (`/api/v1/recipes`, `/api/v1/ingredients`, `/api/v1/collections`, `/api/v1/search`, `/api/v1/account`).
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
export {
    collectionQueries,
    ingredientQueries,
    parseJobIsLive,
    parseJobQueries,
    recipeProjections,
    recipeQueries,
    DEFAULT_PARSE_JOB_POLL_INTERVAL_MS,
    PARSE_JOB_SETTLING_POLL_INTERVAL_MS,
    NUTRITION_BATCH_DEADLINE_MS,
} from './queries.js';

// The query-key factory. Exported from the main barrel (not only the React-only `./hooks` subpath) because a
// key is a plain value: a non-React caller inspecting or seeding the cache needs it without pulling in hooks.
export { recipeServiceKeys } from './queries.js';

export {
    BadRequestError,
    FetchUnavailableError,
    SourceBusyError,
    SourceUnavailableError,
    ForbiddenError,
    GoneError,
    // ⚠️ NOT previously on the barrel, which left the one failure a caller can FIX unnameable outside this
    // package: `InvalidRequestError` means the body this client was handed is illegal per the published
    // contract and NO request went out — a caller bug, distinct from the server's `400`, and the only one
    // where retrying the same body cannot work (see the three-way distinction in `errors.ts`).
    InvalidRequestError,
    NotFoundError,
    ParseJobExpiredError,
    PullDriftError,
    RecipeServiceClientError,
    UnauthorizedError,
    UnexpectedResponseError,
    VersionConflictError,
    isBadRequestError,
    isFetchUnavailableError,
    isSourceBusyError,
    isSourceUnavailableError,
    isForbiddenError,
    isGoneError,
    isInvalidRequestError,
    isNotFoundError,
    isParseJobExpiredError,
    isPullDriftError,
    isRecipeServiceClientError,
    isUnauthorizedError,
    isUnexpectedResponseError,
    isVersionConflictError,
} from './errors.js';

// This client's half of the app-wide query retry policy. It sits beside `errors.ts` because only the module
// that DEFINES a failure can say whether repeating it is worth anything; the app composes the owners'
// predicates rather than re-deriving the classification from status codes.
export { shouldRetryRecipeServiceFailure } from './retryPolicy.js';

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
    LiveIngredientHit,
    LiveIngredientSearchResponse,
    ListCollectionsParams,
    ListRecipesParams,
    PhotoConfirmRequest,
    PhotoUploadUrlRequest,
    PullDiff,
    PullFromSourceResponse,
    RecipeListSortBy,
    RecipeSearchFacetCounts,
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
} from '@kitchensink/recipe-core';

// Wire shapes owned by the GENERATED contract package (authored as zod in the recipe service). Re-exported
// under their existing names so this barrel's public surface is unchanged for its ~121 consumer files.
export type {
    ParseJobLineStatus,
    ParseJobLineView,
    ParseJobResponse,
    ParseJobStatus,
    ParseProposal,
    ParseProposalFood,
    RecipeNutritionResponse,
    RecipeNutritionState,
    RecipeSearchFacets,
    RecipeSearchResponse,
    RestoreVersionResponse,
} from '@kitchensink/schema-recipe';

// The published per-request cap for the deferred nutrition read. Re-exported because a consumer with more
// recipes on screen than this MUST chunk, and it should read the service's own number rather than guess or
// hard-code one that can drift from the contract.
export { MAX_NUTRITION_RECIPE_IDS } from '@kitchensink/schema-recipe';
