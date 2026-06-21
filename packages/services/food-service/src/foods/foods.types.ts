/**
 * Response shapes for the `/v1/foods/*` read API (plan §3).
 *
 * All dates are ISO 8601 strings (NFR-010). Nutrient values are numbers (the DB stores
 * `numeric`/`decimal` which `pg` returns as strings; the repository coerces them).
 */

/** The lifecycle status of a food record (FR-028). */
export type FetchStatus = 'pending' | 'fetched' | 'failed' | 'not_found' | 'stale';

/** Normalized nutrient breakdown (per 100g). All fields nullable; nulls are kept, not omitted. */
export interface FoodNutrients {
    /** Energy in kcal per 100g. */
    calories: number | null;
    /** Protein in grams per 100g. */
    proteinG: number | null;
    /** Carbohydrates in grams per 100g. */
    carbsG: number | null;
    /** Total fat in grams per 100g. */
    fatG: number | null;
    /** Dietary fiber in grams per 100g. */
    fiberG: number | null;
    /** Sodium in milligrams per 100g. */
    sodiumMg: number | null;
    /** Total sugars in grams per 100g. */
    sugarG: number | null;
    /** Saturated fat in grams per 100g. */
    saturatedFatG: number | null;
    /** Cholesterol in milligrams per 100g. */
    cholesterolMg: number | null;
    /** Vitamin A in IU per 100g. */
    vitaminAIu: number | null;
    /** Vitamin C in milligrams per 100g. */
    vitaminCMg: number | null;
    /** Calcium in milligrams per 100g. */
    calciumMg: number | null;
    /** Iron in milligrams per 100g. */
    ironMg: number | null;
}

/** A fetched food, returned by `GET /v1/foods/{fdcId}` (success). */
export interface FoodResponse {
    /** USDA FoodData Central id. */
    fdcId: number;
    /** Human-readable description. */
    description: string | null;
    /** USDA data type (`Foundation` | `SR Legacy` | `Branded`). */
    dataType: string | null;
    /** Macro + micro nutrient breakdown. */
    nutrients: FoodNutrients;
    /** Lifecycle status (`fetched` or `stale`). */
    fetchStatus: FetchStatus;
    /** Present and `true` only when the served record is stale (SWR). */
    stale?: true;
}

/** Body returned when a food is being fetched asynchronously (`202 Accepted`). */
export interface FoodPendingResponse {
    /** Always `'pending'`. */
    status: 'pending';
    /** The requested FDC id. */
    fdcId: number;
    /** Best-effort estimate of seconds until availability. */
    estimatedWaitSeconds: number;
}

/** Body returned by `GET /v1/foods/{fdcId}/status`. */
export interface FoodStatusResponse {
    /** The requested FDC id. */
    fdcId: number;
    /** The current lifecycle status (`not_found` covers tombstoned foods/queue rows). */
    status: FetchStatus;
    /** Present for `pending`/`in_flight` foods: estimated seconds until availability. */
    estimatedWaitSeconds?: number;
    /** Present only when `status === 'fetched'`: the full food payload. */
    food?: FoodResponse;
}

/** A single search/autocomplete result row. */
export interface FoodSearchResult {
    /** USDA FoodData Central id. */
    fdcId: number;
    /** Human-readable description. */
    description: string | null;
    /** USDA data type. */
    dataType: string | null;
}

/** Body returned by `GET /v1/foods/search`. */
export interface FoodSearchResponse {
    /** Ranked results (max 20), or an empty array when no local match exists. */
    foods: FoodSearchResult[];
}

/** Body returned by `GET /v1/foods/autocomplete`. */
export interface FoodAutocompleteResponse {
    /** Ranked suggestions (max 10), or an empty array when no local match exists. */
    suggestions: FoodSearchResult[];
}
