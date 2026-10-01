/**
 * `GET /api/v1/foods/{id}/status` and `GET /api/v1/foods/{id}/candidates` behind the SAME authorship gate as
 * `GET /{id}`, over a real HTTP request with the DAOs DOUBLED (§7.1a). Booted by `support/mockedFoodsApi.ts`.
 *
 * ⛔ THE DEFECT: both routes ran no authorship check while `GET /{id}` did — `/status` handed back a private
 * food's golden record to any authenticated caller, and `/candidates` its candidate matches. Now a caller the
 * policy does not admit gets the 404 a missing id gets.
 *
 * | Requirement | Pinned here |
 * | --- | --- |
 * | a stranger's private food answers exactly as an unknown id | RAW 404 bodies byte-equal, same id, row present vs gone |
 * | a `svc_*` principal authored nothing | 404 |
 * | the author still reads it — and still learns it was WITHDRAWN (owner ruling 5) | 200, status, no `food` body |
 * | catalog and promoted foods stay readable to everyone | 200 |
 * | the requester is resolved as on `GET /{id}` | an unsynced token defers `401 IDENTITY_SYNC_PENDING` |
 * | nothing about a concealed food is read beyond the gate | the candidate store is never called |
 *
 * What a real Postgres does is `tests/e2e/foodByIdAuthorship.e2e.test.ts`'s job.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@kitchensink/clerk-verify', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@kitchensink/clerk-verify')>();

    return { ...actual, verifyClerkToken: vi.fn() };
});

import { verifyClerkToken } from '@kitchensink/clerk-verify';

import { AUTHOR_ID, makeFoodRefFacts, makePrivateFoodRefFacts } from '../src/foods/__fixtures__/foodRefFacts.js';
import { makeGoldenFoodRecord } from '../src/foods/__fixtures__/goldenFoodRecord.js';
import type { FoodRefFacts, GoldenFoodRecord } from '../src/foods/dao/food.dao.js';
import { candidatesResponseSchema, foodErrorSchema, statusResponseSchema } from '../src/foods/foods.schema.js';
import { bootMockedFoodsApi, principalFor, type MockedFoodsApi } from './support/mockedFoodsApi.js';

const mockVerify = vi.mocked(verifyClerkToken);

const FOOD_ID = '01JPR1VATEF00D000000000000';
const CANDIDATE = {
    id: '01JCAND1DATE0000000000000A',
    source: 'usda',
    externalKey: '171688',
    name: 'Broccoli, raw',
    summary: null,
};

describe('GET /{id}/status and /{id}/candidates — the GET /{id} authorship gate (booted Nest, DAOs doubled)', () => {
    /** What the doubled DAOs answer; each case sets them. `undefined` means "no row". */
    let golden: GoldenFoodRecord | undefined;
    let facts: FoodRefFacts | undefined;
    const readGoldenRecord = vi.fn(async () => golden ?? null);
    const readRefFacts = vi.fn(async () => (facts === undefined ? [] : [facts]));
    const getCandidates = vi.fn(async () => [CANDIDATE]);
    let api: MockedFoodsApi;

    beforeAll(async () => {
        api = await bootMockedFoodsApi({
            foodDao: { readGoldenRecord, readRefFacts },
            candidates: { getCandidates },
            // `/status` answers a catalog food with its record, which lists the root's variants (curated U8).
            variants: { listLive: async () => [] },
        });
    });

    afterAll(async () => {
        await api.close();
    });

    beforeEach(() => {
        golden = makeGoldenFoodRecord({
            id: FOOD_ID,
            name: 'Grandma’s spice mix',
            userId: AUTHOR_ID,
            visibility: 'private',
        });
        facts = makePrivateFoodRefFacts({ id: FOOD_ID, status: 'UNRESOLVED' });
        readGoldenRecord.mockClear();
        readRefFacts.mockClear();
        getCandidates.mockClear();
        mockVerify.mockReset();
        mockVerify.mockImplementation(async (token: string) => principalFor(token));
    });

    describe('GET /{id}/status', () => {
        const path = `/api/v1/foods/${FOOD_ID}/status`;

        it('⛔ a stranger gets the 404 an unknown id gets — the RAW bodies are byte-equal', async () => {
            const concealed = await api.call('GET', path, { token: 'stranger' });
            golden = undefined;
            const unknown = await api.call('GET', path, { token: 'stranger' });

            expect(concealed.status).toBe(404);
            expect(foodErrorSchema.parse(concealed.body).code).toBe('FOOD_NOT_FOUND');
            expect(concealed.text).toBe(unknown.text);
        });

        it('⛔ a service principal gets the same 404', async () => {
            const res = await api.call('GET', path, { token: 'service' });

            expect(res.status).toBe(404);
        });

        it('the author reads their own private food, golden record included', async () => {
            const res = await api.call('GET', path, { token: 'author' });

            expect(res.status).toBe(200);
            expect(statusResponseSchema.parse(res.body)).toMatchObject({
                id: FOOD_ID,
                status: 'RESOLVED',
                food: { name: 'Grandma’s spice mix', visibility: 'private' },
            });
        });

        it('the author still learns the food was WITHDRAWN — 200, the status, and NO food body', async () => {
            golden = makeGoldenFoodRecord({
                id: FOOD_ID,
                userId: AUTHOR_ID,
                visibility: 'private',
                status: 'WITHDRAWN',
            });

            const res = await api.call('GET', path, { token: 'author' });

            expect(res.status).toBe(200);
            expect(res.body).toStrictEqual({ id: FOOD_ID, status: 'WITHDRAWN' });
        });

        it.each([
            ['a catalog food', makeGoldenFoodRecord({ id: FOOD_ID })],
            ['a promoted food', makeGoldenFoodRecord({ id: FOOD_ID, userId: AUTHOR_ID, visibility: 'promoted' })],
        ])('a stranger still reads %s', async (_label, record) => {
            golden = record;

            expect((await api.call('GET', path, { token: 'stranger' })).status).toBe(200);
        });

        it('an unsynced user token DEFERS with 401 IDENTITY_SYNC_PENDING, as on GET /{id}', async () => {
            const res = await api.call('GET', path, { token: 'unsynced' });

            expect(res.status).toBe(401);
            expect(foodErrorSchema.parse(res.body).code).toBe('IDENTITY_SYNC_PENDING');
            expect(readGoldenRecord).not.toHaveBeenCalled();
        });
    });

    describe('GET /{id}/candidates', () => {
        const path = `/api/v1/foods/${FOOD_ID}/candidates`;

        it('⛔ a stranger gets the 404 an unknown id gets, and the candidate store is never read', async () => {
            const concealed = await api.call('GET', path, { token: 'stranger' });
            facts = undefined;
            const unknown = await api.call('GET', path, { token: 'stranger' });

            expect(concealed.status).toBe(404);
            expect(concealed.text).toBe(unknown.text);
            expect(getCandidates).not.toHaveBeenCalled();
        });

        it('⛔ a service principal gets the same 404', async () => {
            expect((await api.call('GET', path, { token: 'service' })).status).toBe(404);
            expect(getCandidates).not.toHaveBeenCalled();
        });

        it('a food mid-erasure is a 404 even to its author', async () => {
            facts = makePrivateFoodRefFacts({ id: FOOD_ID, status: 'DELETING' });

            expect((await api.call('GET', path, { token: 'author' })).status).toBe(404);
        });

        it('the author reads their own UNRESOLVED food’s candidates', async () => {
            const res = await api.call('GET', path, { token: 'author' });

            expect(res.status).toBe(200);
            expect(candidatesResponseSchema.parse(res.body).candidates).toHaveLength(1);
        });

        it('a stranger reads a catalog food’s candidates', async () => {
            facts = makeFoodRefFacts({ id: FOOD_ID, status: 'UNRESOLVED' });

            const res = await api.call('GET', path, { token: 'stranger' });

            expect(res.status).toBe(200);
            expect(candidatesResponseSchema.parse(res.body).candidates).toHaveLength(1);
        });

        it('an unsynced user token DEFERS with 401 IDENTITY_SYNC_PENDING', async () => {
            expect((await api.call('GET', path, { token: 'unsynced' })).status).toBe(401);
            expect(readRefFacts).not.toHaveBeenCalled();
        });
    });
});
