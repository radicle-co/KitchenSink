/**
 * `@kitchensink/usda-client` — typed client for the USDA FoodData Central REST API.
 *
 * External-API client only: no database, no HTTP server. Consumed by `@kitchensink/food-service`
 * (the Fargate fetch worker and bulk-sync lambdas).
 */
export { UsdaApiClient, additionalDescriptionsOf } from './UsdaApiClient.js';
export type { UsdaApiClientOptions } from './UsdaApiClient.js';
export { readRateLimitHeaders } from './rateLimit.js';
export type { HeaderBag, UsdaRateLimitSnapshot } from './rateLimit.js';
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
