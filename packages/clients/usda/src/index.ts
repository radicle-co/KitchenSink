/**
 * `@kitchensink/usda-client` — typed client for the USDA FoodData Central REST API.
 *
 * External-API client only: no database, no HTTP server. Consumed by `@kitchensink/food-service`
 * (the Fargate fetch worker and bulk-sync lambdas).
 */
export { UsdaApiClient } from './UsdaApiClient.js';
export type { UsdaApiClientOptions } from './UsdaApiClient.js';
export type { UsdaDataType, UsdaFoodDetail, UsdaNutrient, UsdaSearchHit, UsdaSearchResult } from './types.js';
export {
    RawUsdaFoodArraySchema,
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
