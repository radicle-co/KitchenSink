/**
 * `@kitchensink/food-service-client` (T-057) — the typed client for our own source-agnostic
 * `/api/v1/foods/*` API. Attaches a user-session or M2M bearer token and maps the food service's HTTP
 * contract (`202`/`200` results; `401`/`403`/`400`/`404`/`409`/`503` typed errors; no per-user `429`,
 * `CandidateMismatch` → `409`) to typed results/errors. Named-only barrel (CODING_STANDARDS).
 */
export { FoodServiceClient } from './client.js';
export type { FoodServiceClientOptions, RequestOptions, TokenSource } from './client.js';

export {
    BadRequestError,
    CandidateMismatchError,
    ConflictError,
    FetchUnavailableError,
    FoodServiceClientError,
    ForbiddenError,
    InvalidRequestError,
    NotFoundError,
    SourceUnavailableError,
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
    isSourceUnavailableError,
    isUnauthorizedError,
    isUnexpectedResponseError,
} from './errors.js';

// The wire types are the food service's own, re-exported from `@kitchensink/schema-food` (CODING_STANDARDS
// §15), under the service's own names. The `@deprecated` `*Result`/`FoodView` aliases that used to sit beside
// them — kept so this package's public surface did not churn when the hand-written copies were deleted — have
// been retired; see `types.ts` for which names went and which `*Result` names were never part of that set.
export type {
    AddResponse,
    ApiErrorBody,
    BatchItemView,
    BatchResponse,
    CandidateView,
    CandidatesResponse,
    FoodError,
    FoodErrorCode,
    FoodResponse,
    FoodStatus,
    GetFoodResult,
    LiveSearchResponse,
    LiveSearchResultView,
    NutrientView,
    PendingFoodStatus,
    PendingResponse,
    PortionView,
    ResolveResponse,
    SearchResponse,
    SearchResultView,
    StatusResponse,
    TerminalFoodStatus,
} from './types.js';

export type { CreateAuthoredFoodInput, CreateAuthoredFoodResult, FoodNutritionBatchResult } from './types.js';

// Drift layer 3 (Skew) — CODING_STANDARDS §15.2.5. The comparison itself is internal (the client wires it
// automatically; route the warning with the `onContractSkew` option). Only the TEST SEAM is exported, because a
// CONSUMER's test suite needs it: the once-per-origin latch is module scope, so a consumer asserting on the probe
// — e.g. recipe-service's confused-deputy suite, which proves the probe carries no caller credential — cannot
// make its cases order-independent without being able to clear it. Never call this from production code.
export { resetContractSkewLatchForTests } from './contractSkew.js';
