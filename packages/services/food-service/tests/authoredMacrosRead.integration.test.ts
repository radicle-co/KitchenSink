/**
 * `GET /api/v1/foods/{id}` carries an authored food's `authoredMacros`, over a real HTTP request with the DAOs DOUBLED
 * (§7.1a). Booted by `support/mockedFoodsApi.ts`.
 *
 * The food page's "Your edit" comparison sets what a waiting edit says (`PublicationSnapshot.macros`) beside what the
 * public version says. It used to recover the second by matching nutrient DISPLAY names against patterns, because the
 * wire carried no macro identity. Now an authored food's read carries the four figures as the author wrote them, read
 * from the LIVE row by the dictionary identity they are stored under, so the comparison is macros to macros. They are
 * the figures its `nutrients` already publish to anyone who may read it, so a reader of a public authored food gets
 * them too, and the page draws the same panel for it.
 *
 * | Requirement | Pinned here |
 * | --- | --- |
 * | the author reads the live row's macros, in the PUBLISHED shape | 200, `publishedFoodResponseSchema` parses it |
 * | an edit waiting for staff does not change them | `editWaiting` still answers the live figures |
 * | a reader of a public authored food gets the same figures | the stranger's read carries them, without `publicationState` |
 * | a catalog food carries none | absent |
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@kitchensink/clerk-verify', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@kitchensink/clerk-verify')>();

    return { ...actual, verifyClerkToken: vi.fn() };
});

import { verifyClerkToken } from '@kitchensink/clerk-verify';
import { foodResponseSchema as publishedFoodResponseSchema } from '@kitchensink/schema-food';

import { AUTHOR_ID } from '../src/foods/__fixtures__/foodRefFacts.js';
import { makeGoldenFoodRecord } from '../src/foods/__fixtures__/goldenFoodRecord.js';
import type { GoldenFoodRecord } from '../src/foods/dao/food.dao.js';
import { bootMockedFoodsApi, principalFor, type MockedFoodsApi } from './support/mockedFoodsApi.js';

const mockVerify = vi.mocked(verifyClerkToken);

const FOOD_ID = '01JPR0TE1NB1END00000000000';

const nutrient = (name: string, unit: string, amount: string) => ({
    nutrientId: `n-${name}-${unit}`,
    name,
    unit,
    infoodsTag: null,
    amount,
    basis: 'per_100g',
    source: null,
});

/** The live row: the four figures staff approved, plus the kJ energy a reader must never mistake for kcal. */
const LIVE = [
    nutrient('Energy', 'kj', '1590'),
    nutrient('Energy', 'kcal', '380'),
    nutrient('Protein', 'g', '70'),
    nutrient('Carbohydrate, by difference', 'g', '12.5'),
    nutrient('Total lipid (fat)', 'g', '6'),
];

describe('GET /{id} — an authored food’s own macros (booted Nest, DAOs doubled)', () => {
    let golden: GoldenFoodRecord;
    let state: string;
    let api: MockedFoodsApi;

    beforeAll(async () => {
        api = await bootMockedFoodsApi({
            foodDao: { readGoldenRecord: async () => golden },
            authored: { publicationStateFor: async () => state, markSeen: async () => undefined },
            variants: { listLive: async () => [] },
        });
    });

    afterAll(async () => {
        await api.close();
    });

    beforeEach(() => {
        golden = makeGoldenFoodRecord({
            id: FOOD_ID,
            name: 'Protein blend',
            userId: AUTHOR_ID,
            visibility: 'promoted',
            nutrients: LIVE,
        });
        state = 'public';
        mockVerify.mockReset();
        mockVerify.mockImplementation(async (token: string) => principalFor(token));
    });

    it('the author reads the live row’s four macros, in the published shape', async () => {
        const res = await api.call('GET', `/api/v1/foods/${FOOD_ID}`, { token: 'author' });

        expect(res.status).toBe(200);
        expect(publishedFoodResponseSchema.parse(res.body).authoredMacros).toStrictEqual({
            calories: 380,
            proteinG: 70,
            carbsG: 12.5,
            fatG: 6,
        });
    });

    it('an edit waiting for staff does not change them: the read is the approved version', async () => {
        state = 'editWaiting';

        const res = await api.call('GET', `/api/v1/foods/${FOOD_ID}`, { token: 'author' });

        expect(publishedFoodResponseSchema.parse(res.body)).toMatchObject({
            publicationState: 'editWaiting',
            authoredMacros: { calories: 380, proteinG: 70, carbsG: 12.5, fatG: 6 },
        });
    });

    it('a stranger reading the promoted food reads the same figures, and not where publication stands', async () => {
        const res = await api.call('GET', `/api/v1/foods/${FOOD_ID}`, { token: 'stranger' });
        const body = publishedFoodResponseSchema.parse(res.body);

        expect(body.authoredMacros).toStrictEqual({ calories: 380, proteinG: 70, carbsG: 12.5, fatG: 6 });
        expect(body).not.toHaveProperty('publicationState');
    });

    it('a catalog food carries none', async () => {
        golden = makeGoldenFoodRecord({ id: FOOD_ID, nutrients: LIVE });

        const res = await api.call('GET', `/api/v1/foods/${FOOD_ID}`, { token: 'author' });

        expect(res.status).toBe(200);
        expect(res.body).not.toHaveProperty('authoredMacros');
    });
});
