/**
 * How USDA FoodData Central is searched: the one statement every caller reads (ADR-0055 point 1). Food-service's
 * add-by-name and the remote search service both search through `UsdaApiClient.searchFoods`, which takes the query
 * alone and reads this, so the two cannot ask USDA for different candidates.
 *
 * @pattern Value Object — frozen, so no caller can change what another one asks for
 * @module
 */
import type { UsdaDataType } from './types.js';

/**
 * Search page size. USDA defaults to 50, but the food worker only ever batch-fetches the top `USDA_MAX_BATCH_SIZE`;
 * USDA returns hits in relevance order, so a smaller page yields the same top-N with a much smaller payload. Set
 * EXACTLY to the batch cap so the fan-out issues one search + ONE batch (=2 USDA requests/food, not 3) — every extra
 * hit would force a second batch POST that adds USDA load for no gain.
 */
export const USDA_SEARCH_PAGE_SIZE = 20;

/** The data types a search asks for: those the catalog can cite. Experimental is never searched. */
const SEARCHED_DATA_TYPES = Object.freeze(['Foundation', 'SR Legacy', 'Survey (FNDDS)', 'Branded'] as const);

/** A data type USDA is searched for. */
export type UsdaSearchedDataType = (typeof SEARCHED_DATA_TYPES)[number];

/** The parameters of every USDA search. */
export interface UsdaSearchParameters {
    /** The data types the hits may carry: the search body's `dataType` array. */
    readonly dataTypes: readonly UsdaSearchedDataType[];
    /** The search body's `pageSize`. */
    readonly pageSize: number;
}

/** How every USDA search is made. */
export const USDA_SEARCH_PARAMETERS: UsdaSearchParameters = Object.freeze({
    dataTypes: SEARCHED_DATA_TYPES satisfies readonly UsdaDataType[],
    pageSize: USDA_SEARCH_PAGE_SIZE,
});

/**
 * Whether a value is a data type USDA is searched for. Pure.
 *
 * @param value - Any value, for example a hit's data type.
 * @returns True for one of {@link USDA_SEARCH_PARAMETERS}'s data types.
 */
export function isUsdaSearchedDataType(value: unknown): value is UsdaSearchedDataType {
    return SEARCHED_DATA_TYPES.some((dataType) => dataType === value);
}
