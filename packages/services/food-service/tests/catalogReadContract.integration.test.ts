/**
 * MOCKED integration — the curated catalog's read shapes over the real request path (curated plan U8; KTD-15,
 * SC-013). Boots the controller, guard, pipe, filter and the REAL `FoodsService` with every DAO doubled
 * (`docs/CODING_STANDARDS.md` §7.1a): it proves the route, the status, the wire shape and that the body parses
 * against the PUBLISHED schema package a client imports. What the SQL returns is the LOCAL e2e tier's job
 * (`tests/e2e/catalogReadModel.e2e.test.ts`).
 *
 * | Slice | Pinned here |
 * | --- | --- |
 * | S2 `GET /{id}` gains `variants` | live variants with parts and calories; `[]` for an authored food, with no variant read |
 * | S3 search names a variant | the root's hit carries the one variant its query names, in the published shape |
 * | S4 R19 source-key search | a variant-owned USDA key answers as its ROOT carrying the variant, at score 1 |
 * | S6 nutrition batch | a variant id and a forwarded id answer under the requested id, through the REAL owner reader over doubles; `hasLiveVariants` on roots only |
 * | SC-013 | no part ordinal, item id, citation dataset or external key reaches the body |
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@kitchensink/clerk-verify', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@kitchensink/clerk-verify')>();

    return { ...actual, verifyClerkToken: vi.fn() };
});

import { verifyClerkToken } from '@kitchensink/clerk-verify';
import {
    foodNutritionBatchResponseSchema as publishedNutritionSchema,
    foodResponseSchema as publishedFoodResponseSchema,
    searchResponseSchema as publishedSearchResponseSchema,
} from '@kitchensink/schema-food';

import { AUTHOR_ID } from '../src/foods/__fixtures__/foodRefFacts.js';
import { makeGoldenFoodRecord } from '../src/foods/__fixtures__/goldenFoodRecord.js';
import { makeFoodRefFacts } from '../src/foods/__fixtures__/foodRefFacts.js';
import type { GoldenFoodRecord, NutritionRecord } from '../src/foods/dao/food.dao.js';
import type { SearchHit } from '../src/foods/dao/foodSearch.dao.js';
import type { ListLiveOptions, LiveVariant } from '../src/foods/dao/foodVariant.dao.js';
import { bootMockedFoodsApi, principalFor, type MockedFoodsApi } from './support/mockedFoodsApi.js';

const mockVerify = vi.mocked(verifyClerkToken);

const ROOT_ID = '01JBR1SKETR00T000000000000';
const CITED_KEY = '174531';
const FLAT_KEY = '174532';

/** Two live variants, in the order the DAO answers them, one with no energy figure. */
const VARIANTS: readonly LiveVariant[] = [
    {
        id: '01JBR1SKETF1AT000000000000',
        rootId: ROOT_ID,
        itemId: 'item-flat',
        parts: [
            { attribute: 'cut', ordinal: 0, text: 'flat' },
            { attribute: 'trim', ordinal: 0, text: 'trimmed to 0" fat' },
        ],
        nutrients: [
            {
                nutrient: 'Energy',
                infoodsTag: 'ENERC_KCAL',
                unit: 'kcal',
                basis: 'per_100g',
                amount: '155',
                trace: false,
            },
        ],
    },
    {
        id: '01JBR1SKETP01NT00000000000',
        rootId: ROOT_ID,
        itemId: 'item-point',
        parts: [{ attribute: 'cut', ordinal: 0, text: 'point' }],
        nutrients: [],
    },
];

describe('GET /{id} — the catalog read contract (booted Nest, DAOs doubled)', () => {
    let golden: GoldenFoodRecord;
    const readGoldenRecord = vi.fn(async () => golden);
    // As the DAO does: a variant's nutrition is read only when asked for.
    const listLive = vi.fn(async (_rootIds: readonly string[], options: ListLiveOptions) =>
        VARIANTS.map((variant) => (options.withNutrition ? variant : { ...variant, nutrients: [] })),
    );
    const hit: SearchHit = {
        id: ROOT_ID,
        name: 'beef brisket',
        aliases: 'first cut brisket',
        score: 0.8,
        visibility: 'public',
        userId: null,
    };
    const search = vi.fn(async () => [hit]);
    // A USDA key the flat cut's item carries; any other key names nothing.
    const ownersOfKeys = vi.fn(async (_source: string, keys: readonly string[]) =>
        keys.includes(FLAT_KEY)
            ? new Map([
                  [
                      FLAT_KEY,
                      {
                          kind: 'variant',
                          id: '01JBR1SKETF1AT000000000000',
                          rootId: ROOT_ID,
                          rootName: 'beef brisket',
                          seedOwned: true,
                          parts: [{ attribute: 'cut', ordinal: 0, text: 'flat' }],
                      },
                  ],
              ])
            : new Map(),
    );
    let api: MockedFoodsApi;

    beforeAll(async () => {
        api = await bootMockedFoodsApi({
            foodDao: { readGoldenRecord },
            variants: { listLive },
            searchDao: { search },
            sources: { findFoodIdByBarcode: async () => undefined },
            owners: { ownersOfKeys },
        });
    });

    afterAll(async () => {
        await api.close();
    });

    beforeEach(() => {
        golden = makeGoldenFoodRecord({
            id: ROOT_ID,
            name: 'beef brisket',
            // The crosswalk row the citation names: its key must never reach the read.
            sources: [
                {
                    id: 'source-1',
                    source: 'usda',
                    externalKey: CITED_KEY,
                    itemVersion: null,
                    fetchState: 'fetched',
                    fetchedAt: '2026-09-30T00:00:00.000Z',
                },
            ],
            nutrients: [
                {
                    nutrientId: 'n-energy',
                    name: 'Energy',
                    unit: 'kcal',
                    infoodsTag: 'ENERC_KCAL',
                    amount: '170',
                    basis: 'per_100g',
                    source: 'usda',
                },
            ],
        });
        readGoldenRecord.mockClear();
        listLive.mockClear();
        mockVerify.mockReset();
        mockVerify.mockImplementation(async (token: string) => principalFor(token));
    });

    it('lists the root’s live variants, in the DAO’s order, in the PUBLISHED shape', async () => {
        const res = await api.call('GET', `/api/v1/foods/${ROOT_ID}`, { token: 'stranger' });

        expect(res.status).toBe(200);
        expect(listLive).toHaveBeenCalledWith([ROOT_ID], { withNutrition: true });
        expect(publishedFoodResponseSchema.parse(res.body).variants).toStrictEqual([
            {
                id: '01JBR1SKETF1AT000000000000',
                parts: [
                    { attribute: 'cut', text: 'flat' },
                    { attribute: 'trim', text: 'trimmed to 0" fat' },
                ],
                caloriesPer100g: 155,
            },
            { id: '01JBR1SKETP01NT00000000000', parts: [{ attribute: 'cut', text: 'point' }] },
        ]);
    });

    it('answers `variants: []` for the author’s own authored food, and never reads variants for it', async () => {
        golden = makeGoldenFoodRecord({ id: ROOT_ID, userId: AUTHOR_ID, visibility: 'private' });

        const res = await api.call('GET', `/api/v1/foods/${ROOT_ID}`, { token: 'author' });

        expect(res.status).toBe(200);
        expect(publishedFoodResponseSchema.parse(res.body).variants).toStrictEqual([]);
        expect(listLive).not.toHaveBeenCalled();
    });

    it('S3: a search hit carries the one variant its query names, in the PUBLISHED shape', async () => {
        const res = await api.call('GET', '/api/v1/foods/search?query=beef%20brisket%20flat', { token: 'stranger' });

        expect(res.status).toBe(200);
        expect(publishedSearchResponseSchema.parse(res.body).results).toStrictEqual([
            {
                id: ROOT_ID,
                name: 'beef brisket',
                score: 0.8,
                variant: {
                    id: '01JBR1SKETF1AT000000000000',
                    parts: [
                        { attribute: 'cut', text: 'flat' },
                        { attribute: 'trim', text: 'trimmed to 0" fat' },
                    ],
                },
            },
        ]);
        expect(res.text).not.toContain('item-flat');
        expect(res.text).not.toContain('ordinal');
    });

    it('⛔ S4 R19: a variant-owned USDA key answers as its ROOT carrying the variant, at score 1', async () => {
        search.mockResolvedValueOnce([]);

        const res = await api.call('GET', `/api/v1/foods/search?query=${FLAT_KEY}`, { token: 'stranger' });

        expect(res.status).toBe(200);
        expect(publishedSearchResponseSchema.parse(res.body).results).toStrictEqual([
            {
                id: ROOT_ID,
                name: 'beef brisket',
                score: 1,
                variant: { id: '01JBR1SKETF1AT000000000000', parts: [{ attribute: 'cut', text: 'flat' }] },
            },
        ]);
    });

    it('⛔ SC-013: no ordinal, item id, dataset or external key reaches the body', async () => {
        const res = await api.call('GET', `/api/v1/foods/${ROOT_ID}`, { token: 'stranger' });

        expect(res.status).toBe(200);

        for (const leaked of ['ordinal', 'itemId', 'item-flat', 'dataset', 'externalKey', 'external_key', CITED_KEY]) {
            expect(res.text, leaked).not.toContain(leaked);
        }
    });
});

describe('GET /nutrition — the batch over roots, variants and forwards (booted Nest, real owner reader over doubles)', () => {
    const kcal = (amount: string): NutritionRecord['nutrients'][number] => ({
        nutrient: 'Energy',
        infoodsTag: 'ENERC_KCAL',
        unit: 'kcal',
        basis: 'per_100g',
        amount,
        trace: false,
    });
    const roots = [
        makeFoodRefFacts({ id: 'R-brisket', name: 'beef brisket' }),
        makeFoodRefFacts({ id: 'R-old', retired: true }),
    ];
    const readRefFacts = vi.fn(async (ids: readonly string[]) => roots.filter((root) => ids.includes(root.id)));
    const readNutritionBatch = vi.fn(async (ids: readonly string[]) =>
        [{ id: 'R-brisket', status: 'RESOLVED' as const, nutrients: [kcal('170')], portions: [] }].filter((record) =>
            ids.includes(record.id),
        ),
    );
    const variantFacts = [{ id: 'V-flat', rootId: 'R-brisket', retired: false, parts: [] }];
    let api: MockedFoodsApi;

    beforeAll(async () => {
        api = await bootMockedFoodsApi({
            foodDao: { readRefFacts, readNutritionBatch },
            variants: {
                readFacts: async (ids: readonly string[]) => variantFacts.filter((fact) => ids.includes(fact.id)),
                readNutrition: async (ids: readonly string[]) =>
                    ids.map((id) => ({ id, nutrients: [kcal('155')], portions: [] })),
                liveVariantRoots: async (ids: readonly string[]) => new Set(ids.filter((id) => id === 'R-brisket')),
            },
            forwards: {
                follow: async (ids: readonly string[]) =>
                    new Map(ids.map((id) => [id, { resolved: true, id: 'R-brisket', kind: 'root', hops: 1 }])),
            },
        });
    });

    afterAll(async () => {
        await api.close();
    });

    beforeEach(() => {
        mockVerify.mockReset();
        mockVerify.mockImplementation(async (token: string) => principalFor(token));
    });

    it('answers a root, a forwarded root and a variant under the REQUESTED ids, in the PUBLISHED shape', async () => {
        const res = await api.call('GET', '/api/v1/foods/nutrition?ids=R-brisket,R-old,V-flat,V-nope', {
            token: 'stranger',
        });

        expect(res.status).toBe(200);
        expect(publishedNutritionSchema.parse(res.body)).toStrictEqual({
            foods: [
                { id: 'R-brisket', status: 'RESOLVED', caloriesPer100g: 170, portions: [], hasLiveVariants: true },
                { id: 'R-old', status: 'RESOLVED', caloriesPer100g: 170, portions: [], hasLiveVariants: true },
                { id: 'V-flat', status: 'RESOLVED', caloriesPer100g: 155, portions: [] },
            ],
            unknownIds: ['V-nope'],
        });
    });
});
