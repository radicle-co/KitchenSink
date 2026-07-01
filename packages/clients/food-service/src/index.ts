/**
 * `@kitchensink/food-service-client` (T-057) — the typed client for our own source-agnostic
 * `/v1/foods/*` API. Attaches a user-session or M2M bearer token and maps the food service's HTTP
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

export type {
    AddResult,
    BatchItemView,
    BatchResult,
    CandidateView,
    CandidatesResult,
    FoodStatus,
    FoodView,
    GetFoodResult,
    NutrientView,
    PortionView,
    ResolveResult,
    SearchResult,
    SearchResultView,
    StatusResult,
} from './types.js';
