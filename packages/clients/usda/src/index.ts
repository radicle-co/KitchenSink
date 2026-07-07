/**
 * `@commise/clients-usda` — typed client for the USDA FoodData Central REST API.
 *
 * External-API client only: no database, no HTTP server. Consumed by `@commise/services-food`
 * (the Fargate fetch worker and bulk-sync lambdas).
 */
export { UsdaApiClient } from './usda-api.client.js';
export type { UsdaApiClientOptions } from './usda-api.client.js';
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
