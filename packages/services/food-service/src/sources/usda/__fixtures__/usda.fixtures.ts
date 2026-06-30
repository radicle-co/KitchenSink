/**
 * Fixture factories for the USDA adapter unit tests (T-121). `make*` builders accept `Partial<T>`
 * overrides per the project's fixture convention. These produce the **raw USDA wire bodies** (the
 * shape `@kitchensink/usda-client` validates), plus stub `fetch` implementations so the real
 * `UsdaApiClient` can be exercised without touching the network.
 */

/** A raw USDA nutrient entry as it appears on the wire. */
export interface UsdaNutrientBody {
    nutrientId?: number;
    nutrientName?: string;
    unitName?: string;
    value?: number;
}

/** A raw USDA portion entry as it appears on the wire (preserved in the client's `raw` passthrough). */
export interface UsdaPortionBody {
    gramWeight?: number;
    amount?: number;
    modifier?: string;
    portionDescription?: string;
    measureUnit?: { name?: string };
}

/** A raw USDA food-detail body (`GET /v1/food/{fdcId}`). */
export interface UsdaFoodDetailBody {
    fdcId: number;
    description: string;
    dataType?: string;
    publicationDate?: string;
    brandOwner?: string;
    brandName?: string;
    gtinUpc?: string;
    foodNutrients: UsdaNutrientBody[];
    foodPortions?: UsdaPortionBody[];
}

/** A raw USDA search hit. */
export interface UsdaSearchHitBody {
    fdcId: number;
    description: string;
    dataType?: string;
}

/** A raw USDA search result envelope (`GET /v1/foods/search`). */
export interface UsdaSearchResultBody {
    foods: UsdaSearchHitBody[];
    totalHits: number;
}

/**
 * Build a raw USDA food-detail body. Defaults to "Broccoli, raw" (Foundation) with two case-variant
 * `Protein` rows (to exercise nutrient name normalization/dedup), an `Energy` row, a value-less row
 * (to exercise the skip path), and one portion.
 *
 * @param overrides - Partial fields to override.
 * @returns The raw body.
 */
export function makeUsdaFoodDetailBody(overrides: Partial<UsdaFoodDetailBody> = {}): UsdaFoodDetailBody {
    return {
        fdcId: 171688,
        description: 'Broccoli, raw',
        dataType: 'Foundation',
        publicationDate: '2019-04-01',
        foodNutrients: [
            { nutrientId: 1003, nutrientName: 'Protein', unitName: 'G', value: 2.82 },
            { nutrientId: 1003, nutrientName: 'protein', unitName: 'g', value: 2.82 },
            { nutrientId: 1008, nutrientName: 'Energy', unitName: 'KCAL', value: 34 },
            { nutrientId: 9999, nutrientName: 'Vitamin omitted', unitName: 'MG' },
        ],
        foodPortions: [{ gramWeight: 91, amount: 1, modifier: '1 cup chopped' }],
        ...overrides,
    };
}

/**
 * Build a raw USDA search result body. Defaults to two broccoli hits.
 *
 * @param overrides - Partial fields to override.
 * @returns The raw envelope.
 */
export function makeUsdaSearchResultBody(overrides: Partial<UsdaSearchResultBody> = {}): UsdaSearchResultBody {
    return {
        foods: [
            { fdcId: 171688, description: 'Broccoli, raw', dataType: 'Foundation' },
            { fdcId: 170379, description: 'Broccoli, cooked, boiled', dataType: 'SR Legacy' },
        ],
        totalHits: 2,
        ...overrides,
    };
}

/**
 * A stub `fetch` that always returns `body` as a `200 application/json` response.
 *
 * @param body - The JSON body to return.
 * @returns A `fetch`-compatible function.
 */
export function makeJsonFetch(body: unknown): typeof fetch {
    return () =>
        Promise.resolve(
            new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }),
        );
}

/**
 * A stub `fetch` that always returns the given non-2xx status (empty body).
 *
 * @param status - The HTTP status to return.
 * @returns A `fetch`-compatible function.
 */
export function makeStatusFetch(status: number): typeof fetch {
    return () => Promise.resolve(new Response('', { status }));
}

/**
 * A stub `fetch` that rejects with an `AbortError`, which `UsdaApiClient` maps to a timeout.
 *
 * @returns A `fetch`-compatible function.
 */
export function makeAbortingFetch(): typeof fetch {
    return () => {
        const error = new Error('aborted');
        error.name = 'AbortError';

        return Promise.reject(error);
    };
}
