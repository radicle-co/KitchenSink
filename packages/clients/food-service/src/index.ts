/**
 * `@kitchensink/food-service-client` (T-057) — the typed client for our own source-agnostic
 * `/api/v1/foods/*` API. Attaches a user-session or M2M bearer token and maps the food service's HTTP
 * contract (`202`/`200` results; `401`/`403`/`400`/`404`/`409`/`503` typed errors; no per-user `429`,
 * `CandidateMismatch` → `409`) to typed results/errors. Named-only barrel (CODING_STANDARDS).
 */
export { FoodServiceClient } from './client.js';
export type { FoodServiceClientOptions, TokenSource } from './client.js';

export {
    BadRequestError,
    CandidateMismatchError,
    ConflictError,
    FetchUnavailableError,
    FoodServiceClientError,
    ForbiddenError,
    NotFoundError,
    UnauthorizedError,
    UnexpectedResponseError,
    isBadRequestError,
    isCandidateMismatchError,
    isConflictError,
    isFetchUnavailableError,
    isFoodServiceClientError,
    isForbiddenError,
    isNotFoundError,
    isUnauthorizedError,
    isUnexpectedResponseError,
} from './errors.js';

// The wire types are the food service's own, re-exported from `@kitchensink/schema-food` (CODING_STANDARDS
// §15). The CANONICAL names are the service's; the `*Result`/`FoodView` names below are `@deprecated` aliases
// kept so this package's public surface did not churn when the hand-written copies were deleted.
export type {
    AddResponse,
    ApiErrorBody,
    BatchItemView,
    BatchResponse,
    CandidateView,
    CandidatesResponse,
    ControllerError,
    ErrorResponse,
    FoodResponse,
    FoodStatus,
    GetFoodResult,
    NestHttpError,
    NutrientView,
    PendingFoodStatus,
    PendingResponse,
    PortionView,
    ResolveResponse,
    SearchResponse,
    SearchResultView,
    StatusResponse,
} from './types.js';

export type {
    AddResult,
    BatchResult,
    CandidatesResult,
    FoodView,
    ResolveResult,
    SearchResult,
    StatusResult,
} from './types.js';
