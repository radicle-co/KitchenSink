/**
 * `POST /v1/foods/search` response bodies in the shape the live FoodData Central API sends.
 *
 * The Branded hit and the fields every hit carries follow food-service's committed capture,
 * `tests/e2e/__fixtures__/usda/searchSingleBranded.json`. The broccoli pair's keys and NDB number are the ones
 * `@kitchensink/usda-client`'s client test records from `GET /foods/search?query=broccoli%20raw` (2026-10-01), with
 * the integer NDB number the live API sends. The FNDDS hit's values are illustrative.
 */

/** A raw search hit. The fields past `ndbNumber` are ones the live API sends and the client never reads. */
export interface UsdaSearchHitBody {
    readonly fdcId: number;
    readonly description: string;
    readonly dataType?: string;
    readonly ndbNumber?: number | string;
    readonly [field: string]: unknown;
}

/** A raw search envelope. */
export interface UsdaSearchBody {
    readonly totalHits: number;
    readonly foods: readonly UsdaSearchHitBody[];
    readonly [field: string]: unknown;
}

/** Fields every live hit carries that the client does not read. */
const UNREAD_HIT_FIELDS = {
    publishedDate: '2020-10-30',
    allHighlightFields: '',
    score: 912.3,
    microbes: [],
    foodNutrients: [{ nutrientId: 1003, nutrientName: 'Protein', unitName: 'G', value: 2.57 }],
    finalFoodInputFoods: [],
    foodMeasures: [],
    foodAttributes: [],
    foodAttributeTypes: [],
    foodVersionIds: [],
} as const;

/** A Foundation hit, with its NDB number as the live API's integer. */
export const FOUNDATION_HIT: UsdaSearchHitBody = {
    fdcId: 747447,
    description: 'Broccoli, raw',
    dataType: 'Foundation',
    ndbNumber: 11090,
    foodCategory: 'Vegetables and Vegetable Products',
    ...UNREAD_HIT_FIELDS,
};

/** The SR Legacy hit that shares the Foundation hit's NDB number. */
export const SR_LEGACY_HIT: UsdaSearchHitBody = {
    fdcId: 170379,
    description: 'Broccoli, raw',
    dataType: 'SR Legacy',
    ndbNumber: 11090,
    foodCategory: 'Vegetables and Vegetable Products',
    ...UNREAD_HIT_FIELDS,
};

/** An FNDDS hit: a food code and USDA's alias string, and no NDB number. */
export const FNDDS_HIT: UsdaSearchHitBody = {
    fdcId: 2_709_208,
    description: 'Broccoli, raw',
    dataType: 'Survey (FNDDS)',
    foodCode: 75_109_000,
    additionalDescriptions: 'broccoli, NFS',
    foodCategory: 'Other vegetables',
    ...UNREAD_HIT_FIELDS,
};

/** The recorded Branded hit. */
export const BRANDED_HIT: UsdaSearchHitBody = {
    fdcId: 2_057_648,
    description: 'CHEDDAR CHEESE',
    dataType: 'Branded',
    gtinUpc: '094395000172',
    brandOwner: 'Grafton Village Cheese Co, LLC',
    brandName: 'GRAFTON VILLAGE',
    ingredients: 'UNPASTEURIZED MILK, SALT, CULTURES, ENZYMES.',
    marketCountry: 'United States',
    foodCategory: 'Cheese',
    servingSizeUnit: 'g',
    servingSize: 28,
    ...UNREAD_HIT_FIELDS,
};

/**
 * A search envelope, with the paging fields the live API sends.
 *
 * @param overrides - Fields to replace.
 * @returns The body.
 */
export function makeUsdaSearchBody(overrides: Partial<UsdaSearchBody> = {}): UsdaSearchBody {
    const foods = overrides.foods ?? [FOUNDATION_HIT, SR_LEGACY_HIT, FNDDS_HIT, BRANDED_HIT];

    return {
        totalHits: foods.length,
        currentPage: 1,
        totalPages: 1,
        pageList: [1],
        foodSearchCriteria: { query: 'broccoli', pageNumber: 1, pageSize: 20, requireAllWords: false },
        aggregations: { dataType: {}, nutrients: {} },
        ...overrides,
        foods,
    };
}
