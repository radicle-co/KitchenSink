/**
 * Type contracts for the USDA FoodData Central REST API responses consumed by
 * `UsdaApiClient`. These mirror the subset of the upstream payload the
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

/** Every USDA dataset classification a food record can carry, so a consumer can derive a subset rather than retype one. */
export const USDA_DATA_TYPES = ['Foundation', 'SR Legacy', 'Survey (FNDDS)', 'Branded', 'Experimental'] as const;

/** USDA dataset classification for a food record. */
export type UsdaDataType = (typeof USDA_DATA_TYPES)[number];

const DATA_TYPES: ReadonlySet<string> = new Set(USDA_DATA_TYPES);

/**
 * Whether a value names one of the {@link USDA_DATA_TYPES}. Pure.
 *
 * @param value - Any value.
 * @returns `true` for a known data type.
 */
export function isUsdaDataType(value: unknown): value is UsdaDataType {
    return typeof value === 'string' && DATA_TYPES.has(value);
}

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
    /**
     * USDA's curated alternate names for this food — brands, regional synonyms and alternate forms
     * (`Tillamook`, `sharp cheese`, `Longhorn` for `Cheese, Cheddar`), in USDA's own `rank` order.
     *
     * Total, never `undefined`: `[]` when USDA publishes none (Foundation and SR Legacy rows carry no
     * alias attribute). Named for the field USDA exposes on its SEARCH envelope, which is the name for
     * this knowledge — the detail endpoints carry it as typed `foodAttributes` entries instead, which is
     * what {@link UsdaFoodDetail} normalizes here so no consumer has to know the difference.
     */
    readonly additionalDescriptions: readonly string[];
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
    /**
     * USDA's NDB number, as a decimal string with no leading zeros. An updated food gets a new FDC id and keeps its
     * NDB number, so it links one food across releases. Only Foundation and SR Legacy hits carry one; absent when
     * USDA sends none or sends a malformed value.
     */
    readonly ndbNumber?: string;
}

/** Result envelope for `POST /v1/foods/search`. */
export interface UsdaSearchResult {
    /** Search hits, capped by the upstream `pageSize`. */
    readonly foods: readonly UsdaSearchHit[];
    /** Total upstream match count (may exceed `foods.length`). */
    readonly totalHits: number;
}
