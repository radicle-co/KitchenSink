/**
 * Type contracts for the USDA FoodData Central REST API responses consumed by
 * {@link UsdaApiClient}. These mirror the subset of the upstream payload the
 * food-service needs; the full upstream object is preserved verbatim in `raw`.
 */

/** A single nutrient measurement from the USDA `foodNutrients` array. */
export interface UsdaNutrient {
    /** USDA nutrient id (e.g. 1008 = Energy). */
    readonly nutrientId: number;
    /** Human-readable nutrient name (e.g. `Energy`). */
    readonly nutrientName: string;
    /** Unit of measure for {@link value} (e.g. `KCAL`, `G`, `MG`). */
    readonly unitName: string;
    /** Measured amount per 100g, or `undefined` when USDA omits it. */
    readonly value?: number;
}

/** USDA dataset classification for a food record. */
export type UsdaDataType = 'Foundation' | 'SR Legacy' | 'Branded' | 'Survey (FNDDS)' | 'Experimental';

/** Detailed food record returned by `GET /v1/food/{fdcId}` and `POST /v1/foods`. */
export interface UsdaFoodDetail {
    /** USDA FoodData Central id (primary key). */
    readonly fdcId: number;
    /** Food description / display name. */
    readonly description: string;
    /** Dataset the record belongs to, when present. */
    readonly dataType?: UsdaDataType;
    /** Nutrient measurements per 100g. */
    readonly foodNutrients: readonly UsdaNutrient[];
    /** Brand owner (Branded Foods only). */
    readonly brandOwner?: string;
    /** Brand name (Branded Foods only). */
    readonly brandName?: string;
    /** UPC/GTIN barcode (Branded Foods only). */
    readonly gtinUpc?: string;
    /** Last USDA publication date as an ISO 8601 string, when present. */
    readonly publicationDate?: string;
    /** The verbatim upstream payload, preserved for `foods.raw_json`. */
    readonly raw: Record<string, unknown>;
}

/** A single hit in the USDA `POST /v1/foods/search` response. */
export interface UsdaSearchHit {
    /** USDA FoodData Central id. */
    readonly fdcId: number;
    /** Food description / display name. */
    readonly description: string;
    /** Dataset the record belongs to, when present. */
    readonly dataType?: UsdaDataType;
}

/** Result envelope for `GET /v1/foods/search`. */
export interface UsdaSearchResult {
    /** Search hits, capped by the upstream `pageSize`. */
    readonly foods: readonly UsdaSearchHit[];
    /** Total upstream match count (may exceed `foods.length`). */
    readonly totalHits: number;
}
