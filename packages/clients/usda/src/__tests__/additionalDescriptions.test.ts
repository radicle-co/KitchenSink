/**
 * Unit tests for USDA's curated alias table — the `Additional Description` attributes the client used to
 * discard at the boundary (plan U2 / KTD-2).
 *
 * ## What this file pins, and why it is not the field the plan named
 *
 * KTD-2 says the aliases are "exposed by the FDC API as `additionalDescriptions`". That is true of the
 * **search** envelope (`SearchResultFood.additionalDescriptions`, a `;`-joined string) and false of the
 * **detail** endpoints — and detail is the only carrier on the path that PERSISTS. Probed live against
 * FDC on 2026-08-21:
 *
 *   GET /v1/foods/search?query=cheese cheddar   → 2705709 additionalDescriptions =
 *       'Pioneer;New York;Tillamook;Coon;Longhorn;sharp cheese;Hoop;Wisconsin'
 *   GET /v1/food/2705709                        → NO `additionalDescriptions` key at all; the same eight
 *       values arrive as `foodAttributes[]` entries whose `foodAttributeType.name` is
 *       'Additional Description', each with its own `rank`.
 *   POST /v1/foods {"fdcIds":[2705709]}         → same as detail (11 attributes, 8 of them aliases).
 *
 * `UsdaSourceAdapter.fetchByKey`/`fetchByKeys` read detail, so parsing only the flat string would have
 * recovered NOTHING on the write path while looking correct. These tests therefore pin the ATTRIBUTE
 * carrier, and the client normalizes it under USDA's own name for the knowledge.
 *
 * Mutation lens: each case reds if the attribute-type filter is dropped (every attribute would become an
 * alias, including `WWEIA Category description`), if `rank` ordering is lost, if blank/whitespace values
 * stop being dropped, or if the field stops being surfaced on the typed detail at all.
 */
import { describe, expect, it, vi } from 'vitest';

import { UsdaApiClient, additionalDescriptionsOf } from '../UsdaApiClient.js';

/** Build a minimal `Response`-shaped object the client can consume. */
function mockResponse(body: unknown): Response {
    return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

/** Construct a client whose HTTP layer returns `body` for every call. */
function makeClient(body: unknown): UsdaApiClient {
    return new UsdaApiClient({
        apiKey: 'test-key',
        fetchFn: vi.fn().mockResolvedValue(mockResponse(body)) as unknown as typeof fetch,
    });
}

/** The `foodAttributeType` object USDA stamps on an alias attribute (type id 1001). */
const ALIAS_TYPE = { id: 1001, name: 'Additional Description', description: 'Additional descriptions for the food.' };

/** A verbatim slice of FDC's `GET /v1/food/2705709` response (Cheese, Cheddar — Survey/FNDDS). */
const CHEDDAR_ATTRIBUTES = [
    {
        id: 3298966,
        name: 'WWEIA Category description',
        value: 'Cheese',
        foodAttributeType: { id: 999, name: 'Attribute' },
    },
    { id: 3309763, value: 'Wisconsin', foodAttributeType: ALIAS_TYPE, rank: 7 },
    { id: 3309758, value: 'sharp cheese', foodAttributeType: ALIAS_TYPE, rank: 2 },
    { id: 3309759, value: 'Tillamook', foodAttributeType: ALIAS_TYPE, rank: 3 },
];

describe('additionalDescriptionsOf', () => {
    it('keeps only attributes typed as an Additional Description', () => {
        // `WWEIA Category description` is an attribute too, and it is a CATEGORY, not an alias. Admitting
        // it would index every FNDDS food under its food group and make `cheese` match 300 unrelated rows.
        expect(additionalDescriptionsOf(CHEDDAR_ATTRIBUTES)).toEqual(['sharp cheese', 'Tillamook', 'Wisconsin']);
    });

    it('orders by USDA rank, not by array order', () => {
        // FDC returns the attributes unordered (7, 2, 3 above). `rank` is USDA's own curation order, and it
        // is the only signal we have for which alias is the most representative.
        const ranked = additionalDescriptionsOf([
            { value: 'third', foodAttributeType: ALIAS_TYPE, rank: 3 },
            { value: 'first', foodAttributeType: ALIAS_TYPE, rank: 1 },
            { value: 'second', foodAttributeType: ALIAS_TYPE, rank: 2 },
        ]);

        expect(ranked).toEqual(['first', 'second', 'third']);
    });

    it('keeps an unranked alias in input order, after every ranked one', () => {
        const ranked = additionalDescriptionsOf([
            { value: 'unranked-a', foodAttributeType: ALIAS_TYPE },
            { value: 'ranked', foodAttributeType: ALIAS_TYPE, rank: 9 },
            { value: 'unranked-b', foodAttributeType: ALIAS_TYPE },
        ]);

        expect(ranked).toEqual(['ranked', 'unranked-a', 'unranked-b']);
    });

    it('trims each value and drops the blank ones', () => {
        expect(
            additionalDescriptionsOf([
                { value: '  Coon  ', foodAttributeType: ALIAS_TYPE, rank: 1 },
                { value: '   ', foodAttributeType: ALIAS_TYPE, rank: 2 },
                { value: '', foodAttributeType: ALIAS_TYPE, rank: 3 },
                { foodAttributeType: ALIAS_TYPE, rank: 4 },
            ]),
        ).toEqual(['Coon']);
    });

    it('is empty for a food with no attributes at all', () => {
        expect(additionalDescriptionsOf([])).toEqual([]);
    });

    it('matches the attribute type case-insensitively but never on a partial name', () => {
        expect(
            additionalDescriptionsOf([{ value: 'x', foodAttributeType: { name: 'additional description' } }]),
        ).toEqual(['x']);
        expect(additionalDescriptionsOf([{ value: 'x', foodAttributeType: { name: 'Additional' } }])).toEqual([]);
    });
});

describe('UsdaApiClient surfaces the aliases on the typed detail', () => {
    it('getFood carries them through as additionalDescriptions', async () => {
        const client = makeClient({
            fdcId: 2705709,
            description: 'Cheese, Cheddar',
            dataType: 'Survey (FNDDS)',
            foodNutrients: [],
            foodAttributes: CHEDDAR_ATTRIBUTES,
        });

        const food = await client.getFood(2705709);

        expect(food.additionalDescriptions).toEqual(['sharp cheese', 'Tillamook', 'Wisconsin']);
    });

    it('getFoodsBatch carries them through too — it is the path the fan-out worker uses', async () => {
        const client = makeClient([
            {
                fdcId: 2705709,
                description: 'Cheese, Cheddar',
                foodNutrients: [],
                foodAttributes: CHEDDAR_ATTRIBUTES,
            },
        ]);

        const [food] = await client.getFoodsBatch([2705709]);

        expect(food?.additionalDescriptions).toEqual(['sharp cheese', 'Tillamook', 'Wisconsin']);
    });

    it('is an empty list — never undefined — for a food USDA publishes no aliases for', async () => {
        // Foundation and SR Legacy rows return `additionalDescriptions: ''` on search and carry no alias
        // attribute on detail. The typed shape stays total so no consumer has to branch on absence.
        const client = makeClient({ fdcId: 328637, description: 'Cheese, cheddar', foodNutrients: [] });

        const food = await client.getFood(328637);

        expect(food.additionalDescriptions).toEqual([]);
    });

    it('rejects a body whose foodAttributes is not an array (upstream shape drift)', async () => {
        const client = makeClient({ fdcId: 1, description: 'x', foodNutrients: [], foodAttributes: 'nope' });

        await expect(client.getFood(1)).rejects.toThrow();
    });
});
