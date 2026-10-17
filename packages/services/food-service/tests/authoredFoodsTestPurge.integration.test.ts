/**
 * Integration (mocked, `docs/CODING_STANDARDS.md` §7.1a): the test purge route, `POST /api/v1/foods/authored/test-purge`
 * (ADR-0040 food half), over the real Nest app, guard, pipes and filter, with the purge service doubled. What a real
 * database shows (the rows deleted, the rows kept) is `tests/e2e/testPickedRoots.e2e.test.ts` and
 * `tests/e2e/authoredFoodsTestPurge.e2e.test.ts`.
 *
 * | Case                                                              | Pinned                                          |
 * | ----------------------------------------------------------------- | ----------------------------------------------- |
 * | a signed test principal purges itself                             | `200` with all three counts, keyed on its ULID  |
 * | the counts are the published contract                             | the body parses with the schema, picked roots in |
 * | a real cook, or a token the guard refuses                         | the unrouted `404` / `401`, the purge never runs |
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@kitchensink/clerk-verify', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@kitchensink/clerk-verify')>();

    return { ...actual, verifyClerkToken: vi.fn() };
});

import { verifyClerkToken } from '@kitchensink/clerk-verify';

import { POOL_ID } from '../src/foods/__fixtures__/foodRefFacts.js';
import { authoredFoodTestPurgeResponseSchema } from '../src/foods/foods.schema.js';
import { bootMockedFoodsApi, principalFor, type MockedFoodsApi } from './support/mockedFoodsApi.js';

const mockVerify = vi.mocked(verifyClerkToken);
const PURGE = '/api/v1/foods/authored/test-purge';
const purge = vi.fn();

let api: MockedFoodsApi;

beforeAll(async () => {
    api = await bootMockedFoodsApi({ foodDao: {}, testPurge: { purge } });
});

afterAll(async () => {
    await api.close();
});

beforeEach(() => {
    mockVerify.mockReset();
    mockVerify.mockImplementation(async (token: string) => principalFor(token));
    purge.mockReset();
});

describe('POST /api/v1/foods/authored/test-purge', () => {
    it('purges a signed test principal by its app-user ULID and answers all three counts', async () => {
        purge.mockResolvedValue({ deletedAuthoredFoods: 2, retainedPromotedFoods: 1, deletedPickedRoots: 3 });

        const res = await api.call('POST', PURGE, { token: 'pool' });

        expect(res.status).toBe(200);
        expect(authoredFoodTestPurgeResponseSchema.parse(res.body)).toStrictEqual({
            deletedAuthoredFoods: 2,
            retainedPromotedFoods: 1,
            deletedPickedRoots: 3,
        });
        expect(purge).toHaveBeenCalledExactlyOnceWith(POOL_ID);
    });

    it('⛔ answers a real cook with the unrouted 404, and purges nothing', async () => {
        const res = await api.call('POST', PURGE, { token: 'author' });

        expect(res.status).toBe(404);
        expect(purge).not.toHaveBeenCalled();
    });

    it('answers a token the guard refuses with 401, and purges nothing', async () => {
        const res = await api.call('POST', PURGE, { token: 'nobody' });

        expect(res.status).toBe(401);
        expect(purge).not.toHaveBeenCalled();
    });
});
