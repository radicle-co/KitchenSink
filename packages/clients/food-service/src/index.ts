/**
 * `@kitchensink/food-service-client` (T-057) — the typed client for our own source-agnostic
 * `/api/v1/foods/*` API. Attaches a user-session or M2M bearer token and maps the food service's HTTP
 * contract (`202`/`200` results; `401`/`403`/`400`/`404`/`409`/`429`/`503` typed errors, the `429` being only
 * the caller's own limit on search, resolve and the remote pick; `CandidateMismatch` → `409`) to typed results/errors.
 * Named-only barrel (CODING_STANDARDS).
 */
export { FoodServiceClient } from './client.js';
export type { FoodServiceClientOptions, RequestOptions } from './client.js';
export type { TokenSource } from '@kitchensink/retry-after/bearer-replay';

// The progressive search's frames as this client reads them, and the answer they fold into (ADR-0055 point 9).
export type { ProgressiveFrame, ProgressiveSourceFrame } from './progressiveFrames.js';
export { EMPTY_PROGRESSIVE_ANSWER, withProgressiveFrame } from './progressiveAnswer.js';
export type { ProgressiveAnswer } from './progressiveAnswer.js';

// This client's half of the app-wide query retry policy, beside `errors.ts` because only the module that DEFINES a
// failure can say whether repeating it is worth anything (`@commise/query` composes the halves).
export { shouldRetryFoodServiceFailure } from './retryPolicy.js';

export {
    BadRequestError,
    CandidateMismatchError,
    ConflictError,
    FetchUnavailableError,
    FoodServiceClientError,
    ForbiddenError,
    InvalidRequestError,
    NotFoundError,
    RateLimitedError,
    RemoteFoodGoneError,
    RequesterLimitReachedError,
    SearchRateLimitedError,
    SourceBusyError,
    UnauthorizedError,
    UnexpectedResponseError,
    isBadRequestError,
    isCandidateMismatchError,
    isConflictError,
    isFetchUnavailableError,
    isFoodServiceClientError,
    isForbiddenError,
    isInvalidRequestError,
    isNotFoundError,
    isRateLimitedError,
    isRemoteFoodGoneError,
    isRequesterLimitReachedError,
    isSearchRateLimitedError,
    isSourceBusyError,
    isUnauthorizedError,
    isUnexpectedResponseError,
} from './errors.js';

// The wire types are the food service's own, re-exported from `@kitchensink/schema-food` under the service's own names
// (CODING_STANDARDS §15). This is the one list of them; `types.ts` holds only the types this client owns.
export type {
    AddResponse,
    AdoptRemoteFoodResponse,
    ApiErrorBody,
    AuthoredGroup,
    AuthoredFoodSearchResponse,
    AuthoredFoodSearchResultView,
    BatchItemView,
    BatchResponse,
    CandidateView,
    CandidatesResponse,
    CatalogGroup,
    CatalogSearchResponse,
    CatalogSearchResultView,
    DatabaseFrame,
    DataSourcesResponse,
    DataSourceView,
    FoodError,
    FoodErrorCode,
    FoodRef,
    FoodRefEntry,
    FoodRefKind,
    FoodResponse,
    FoodStatus,
    GetFoodResult,
    NutrientView,
    PendingFoodStatus,
    PendingResponse,
    PortionView,
    RemoteFoodView,
    ResolveFoodRefsResponse,
    ResolveResponse,
    SearchResponse,
    SearchResultView,
    StatusResponse,
    TerminalFoodStatus,
    VariantPartView,
    VariantView,
} from '@kitchensink/schema-food';

// The order in which a variant's parts arrive, and in which a reader groups variants (curated KTD-7, U14). A value,
// so it is re-exported from the contract rather than restated.
export { VARIANT_ATTRIBUTES } from '@kitchensink/schema-food';

export type { CreateAuthoredFoodInput, CreateAuthoredFoodResult, FoodNutritionBatchResult } from './types.js';

// Drift layer 3 (Skew) — CODING_STANDARDS §15.2.5. The comparison itself is internal (the client wires it
// automatically; route the warning with the `onContractSkew` option). Only the TEST SEAM is exported, because a
// CONSUMER's test suite needs it: the once-per-origin latch is module scope, so a consumer asserting on the probe
// — e.g. recipe-service's confused-deputy suite, which proves the probe carries no caller credential — cannot
// make its cases order-independent without being able to clear it. Never call this from production code.
export { resetContractSkewLatchForTests } from './contractSkew.js';
