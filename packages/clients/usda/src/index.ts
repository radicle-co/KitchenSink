/**
 * `@kitchensink/usda-client` — typed client for the USDA FoodData Central REST API.
 *
 * External-API client only: no database, no HTTP server. Consumed by `@kitchensink/food-service`
 * (the Fargate fetch worker and bulk-sync lambdas) and `@kitchensink/remote-search-service`.
 */
export {
    UsdaApiClient,
    USDA_MAX_BATCH_SIZE,
    USDA_REQUEST_TIMEOUT_MS,
    additionalDescriptionsOf,
} from './UsdaApiClient.js';
export { foundationLineageKey, isLineageKey } from './lineageKey.js';
export type { LineageKey } from './lineageKey.js';
export { normalizeNdbNumber } from './ndbNumber.js';
export { USDA_QUOTA_HEADERS } from './quotaHeaders.js';
export { usdaSearchCandidate } from './searchCandidate.js';
export type { UsdaSearchCandidate } from './searchCandidate.js';
export { USDA_SEARCH_PAGE_SIZE, USDA_SEARCH_PARAMETERS, isUsdaSearchedDataType } from './searchParameters.js';
export type { UsdaSearchedDataType, UsdaSearchParameters } from './searchParameters.js';
export type { UsdaApiClientOptions } from './UsdaApiClient.js';
export { USDA_DATA_TYPES } from './types.js';
export type { UsdaDataType, UsdaFoodDetail, UsdaNutrient, UsdaSearchHit, UsdaSearchResult } from './types.js';
export {
    ADDITIONAL_DESCRIPTION_ATTRIBUTE,
    RawUsdaFoodArraySchema,
    RawUsdaFoodAttributeSchema,
    RawUsdaFoodSchema,
    RawUsdaNutrientSchema,
    RawUsdaSearchHitSchema,
    RawUsdaSearchResultSchema,
    UsdaFoodDetailSchema,
    UsdaSearchResultSchema,
} from './schemas.js';
export type {
    RawUsdaFood,
    RawUsdaFoodArray,
    RawUsdaFoodAttribute,
    RawUsdaNutrient,
    RawUsdaSearchHit,
    RawUsdaSearchResult,
} from './schemas.js';
export {
    InvalidBatchSizeError,
    UsdaClientError,
    UsdaNotFoundError,
    UsdaRateLimitError,
    UsdaSchemaError,
    UsdaServerError,
    UsdaTimeoutError,
    isInvalidBatchSizeError,
    isUsdaClientError,
    isUsdaNotFoundError,
    isUsdaRateLimitError,
    isUsdaSchemaError,
    isUsdaServerError,
    isUsdaTimeoutError,
} from './errors.js';
