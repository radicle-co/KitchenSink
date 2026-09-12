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

/**
 * A raw USDA `labelNutrients` panel as it appears on the wire (Branded Foods only): a map of label
 * keys (`protein`, `fat`, `calories`, …) to a per-serving `{ value }`. Preserved in the client's `raw`
 * passthrough — the typed `UsdaFoodDetail` does not surface it.
 */
export interface UsdaLabelNutrientsBody {
    [labelKey: string]: { value?: number } | undefined;
}

/**
 * A raw `foodAttributes[]` entry as it appears on a USDA food-detail body. The alias entries carry
 * `foodAttributeType.name = 'Additional Description'` and a `rank`; the same array also holds WWEIA
 * category attributes, which are NOT names for the food.
 */
export interface UsdaFoodAttributeBody {
    value?: string;
    rank?: number;
    foodAttributeType?: { id?: number; name?: string };
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
    foodAttributes?: UsdaFoodAttributeBody[];
    foodPortions?: UsdaPortionBody[];
    servingSize?: number;
    servingSizeUnit?: string;
    labelNutrients?: UsdaLabelNutrientsBody;
}

/**
 * Build the `foodAttributes` array USDA returns for a food with curated aliases, verbatim in shape:
 * one WWEIA category attribute (which must be ignored) plus one alias attribute per supplied value,
 * ranked in the order given but emitted in REVERSE so a test cannot pass by accident of array order.
 *
 * @param values - The alias values, in the rank order USDA would publish them.
 * @returns The raw attribute array.
 */
export function makeUsdaAliasAttributes(values: readonly string[]): UsdaFoodAttributeBody[] {
    const aliases = values.map((value, index) => ({
        value,
        rank: index + 1,
        foodAttributeType: { id: 1001, name: 'Additional Description' },
    }));

    return [
        { value: 'Cheese', foodAttributeType: { id: 999, name: 'WWEIA Category description' } },
        ...aliases.reverse(),
    ];
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
 * Build a raw USDA Branded food-detail body whose Nutrition-Facts panel ships as a per-serving
 * `labelNutrients` map with a `servingSize`/`servingSizeUnit`. Defaults to a 30 g serving with NO
 * per-100g `foodNutrients` (the gap case the merge engine used to drop). Override `servingSizeUnit`
 * to `'ml'` (or a count) to exercise the keep-as-`per_serving` path, or supply `foodNutrients` to
 * exercise the "prefer foodNutrients, do not double-count the label" path.
 *
 * @param overrides - Partial fields to override.
 * @returns The raw body.
 */
export function makeUsdaBrandedLabelBody(overrides: Partial<UsdaFoodDetailBody> = {}): UsdaFoodDetailBody {
    return {
        fdcId: 555001,
        description: 'Acme Protein Crackers',
        dataType: 'Branded',
        brandOwner: 'Acme Foods',
        gtinUpc: '0123456789012',
        publicationDate: '2023-08-01',
        servingSize: 30,
        servingSizeUnit: 'g',
        foodNutrients: [],
        labelNutrients: {
            protein: { value: 6 },
            fat: { value: 9 },
            calories: { value: 45 },
        },
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
