/**
 * Every route that discloses a catalog root id holds it against the test purge (ADR-0040 food half), over a real HTTP
 * request with the DAOs DOUBLED (`docs/CODING_STANDARDS.md` §7.1a: integration mocks its dependencies). Booted by
 * `support/mockedFoodsApi.ts`: the real auth guard, pipe, controller, service and filter, and the REAL `AnsweredRoots`
 * door with the real `testPickedRootPolicy` over a doubled attribution table.
 *
 * | Path a real cook can learn a root id by | Pinned here                                              |
 * | --------------------------------------- | -------------------------------------------------------- |
 * | `GET /search`                           | the hit ids reach the table's hold                       |
 * | `GET /catalog/search`                   | held for ANY caller, a test principal included           |
 * | `POST /`, `POST /batch`                 | the answered ids and the forward target                  |
 * | `POST /refs/resolve`                    | the refs asked about, held before the read               |
 * | `GET /{id}/status`                      | the id, held before the read                             |
 * | a test principal on a per-caller route  | NO hold, so its own purge still reaches what it shares   |
 *
 * What the database does with a hold (the `UPDATE`, the lock, the purge that follows) is
 * `tests/e2e/testPickedRoots.e2e.test.ts`'s job.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@kitchensink/clerk-verify', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@kitchensink/clerk-verify')>();

    return { ...actual, verifyClerkToken: vi.fn() };
});

import { verifyClerkToken } from '@kitchensink/clerk-verify';

import { makeFoodRefFacts } from '../src/foods/__fixtures__/foodRefFacts.js';
import { makeGoldenFoodRecord } from '../src/foods/__fixtures__/goldenFoodRecord.js';
import { AnsweredRoots } from '../src/foods/answeredRoots.js';
import type { CreateByNameResult } from '../src/foods/dao/food.dao.js';
import { bootMockedFoodsApi, principalFor, type MockedFoodsApi } from './support/mockedFoodsApi.js';

const mockVerify = vi.mocked(verifyClerkToken);
const ROOT_ID = '01JCATA10GF00D000000000000';

describe('the routes that name a root hold it (booted Nest, DAOs doubled)', () => {
    /** Every id the attribution table was asked to hold, one entry per write. */
    const writes: string[][] = [];
    let created: CreateByNameResult;
    let api: MockedFoodsApi;

    beforeAll(async () => {
        api = await bootMockedFoodsApi({
            foodDao: {
                createByName: async () => created,
                getById: async () => ({ id: ROOT_ID, name: 'kale', status: 'RESOLVED' }),
                readRefFacts: async () => [makeFoodRefFacts({ id: ROOT_ID, name: 'Kale' })],
                readGoldenRecord: async () => makeGoldenFoodRecord({ id: ROOT_ID }),
            },
            searchDao: {
                search: async () => [{ id: ROOT_ID, name: 'kale', aliases: null, score: 0.9 }],
                searchCatalog: async () => [{ id: ROOT_ID, name: 'kale', aliases: null, score: 0.9 }],
            },
            sources: {
                findCatalogFoodByBarcode: async () => undefined,
                findCatalogFoodById: async () => undefined,
                ownersOf: async () => [],
                citingSeedRoots: async () => new Map(),
            },
            variants: { listLive: async () => [], readFacts: async () => [] },
            enqueue: { publishFoodRequested: async () => undefined, publishFoodBatchRequested: async () => undefined },
            answeredRoots: new AnsweredRoots({
                markHeldByRealUser: async (ids) => {
                    writes.push([...ids]);
                },
            }),
        });
    });

    afterAll(async () => {
        await api.close();
    });

    beforeEach(() => {
        writes.length = 0;
        created = { id: ROOT_ID, created: true, reactivated: false };
        mockVerify.mockReset();
        mockVerify.mockImplementation(async (token: string) => principalFor(token));
    });

    it.each([
        ['GET /search', 'GET', `/api/v1/foods/search?query=kale`, undefined],
        ['POST /', 'POST', '/api/v1/foods', { name: 'kale' }],
        ['POST /batch', 'POST', '/api/v1/foods/batch', { names: ['kale'] }],
        ['POST /refs/resolve', 'POST', '/api/v1/foods/refs/resolve', { refs: [{ kind: 'root', id: ROOT_ID }] }],
        ['GET /{id}/status', 'GET', `/api/v1/foods/${ROOT_ID}/status`, undefined],
    ] as const)('⛔ %s holds the root a real cook was answered with', async (_name, method, path, body) => {
        const res = await api.call(method, path, { token: 'stranger', body });

        expect(res.status).toBeLessThan(300);
        expect(writes.flat()).toContain(ROOT_ID);
    });

    it.each([
        ['GET /search', 'GET', `/api/v1/foods/search?query=kale`, undefined],
        ['POST /', 'POST', '/api/v1/foods', { name: 'kale' }],
        ['POST /batch', 'POST', '/api/v1/foods/batch', { names: ['kale'] }],
        ['GET /{id}/status', 'GET', `/api/v1/foods/${ROOT_ID}/status`, undefined],
    ] as const)(
        '%s does NOT hold for a test principal: its own purge must still reach what it shares',
        async (_name, method, path, body) => {
            const res = await api.call(method, path, { token: 'pool', body });

            expect(res.status).toBeLessThan(300);
            expect(writes).toStrictEqual([]);
        },
    );

    it('⛔ GET /catalog/search holds the hits for a test principal too: the edge shares its answer with every caller', async () => {
        const res = await api.call('GET', '/api/v1/foods/catalog/search?query=kale', { token: 'pool' });

        expect(res.status).toBe(200);
        expect(writes).toStrictEqual([[ROOT_ID]]);
    });

    it('⛔ refuses to answer when the hold cannot be written, so no id leaves unprotected', async () => {
        const failing = await bootMockedFoodsApi({
            foodDao: { readRefFacts: async () => [] },
            searchDao: { searchCatalog: async () => [{ id: ROOT_ID, name: 'kale', aliases: null, score: 0.9 }] },
            sources: { findCatalogFoodByBarcode: async () => undefined, findCatalogFoodById: async () => undefined },
            owners: { ownersOfKeys: async () => new Map() },
            variants: { listLive: async () => [] },
            answeredRoots: {
                hold: async () => {
                    throw new Error('database down');
                },
            },
        });

        try {
            const res = await failing.call('GET', '/api/v1/foods/catalog/search?query=kale', { token: 'stranger' });

            expect(res.status).toBe(500);
            expect(res.text).not.toContain(ROOT_ID);
        } finally {
            await failing.close();
        }
    });
});
