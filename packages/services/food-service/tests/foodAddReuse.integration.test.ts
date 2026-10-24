/**
 * `POST /api/v1/foods` and `POST /api/v1/foods/batch` for a name that IS a catalog variant, over a real HTTP request
 * with the DAOs DOUBLED (§7.1a). Booted by `support/mockedFoodsApi.ts`: the real auth guard, pipe, controller, service,
 * catalog name matcher and exception filter; no database.
 *
 * | Requirement | Pinned here |
 * | --- | --- |
 * | the store is told which variant the name is | `createByName` receives `forwardsTo` |
 * | a reused retired root is answered `RESOLVED`, naming the variant | the body parses against the PUBLISHED schemas |
 * | nothing is queued for it | the enqueue double is never called |
 * | a name that is no variant sends no `forwardsTo` | the first add is unchanged |
 *
 * What the store does with `forwardsTo` (one row however often a name is added) is
 * `tests/e2e/food.dao.e2e.test.ts`'s and `tests/e2e/heldSourceItems.e2e.test.ts`'s job.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@kitchensink/clerk-verify', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@kitchensink/clerk-verify')>();

    return { ...actual, verifyClerkToken: vi.fn() };
});

import { verifyClerkToken } from '@kitchensink/clerk-verify';

import type { CreateByNameInput, CreateByNameResult } from '../src/foods/dao/food.dao.js';
import type { CatalogSearchHit } from '../src/foods/dao/foodSearch.dao.js';
import type { LiveVariant } from '../src/foods/dao/foodVariant.dao.js';
import { addResponseSchema, batchResponseSchema } from '../src/foods/foods.schema.js';
import { bootMockedFoodsApi, principalFor, type MockedFoodsApi } from './support/mockedFoodsApi.js';

const mockVerify = vi.mocked(verifyClerkToken);

const ROOT: CatalogSearchHit = { id: 'R-broccoli', name: 'Broccoli', aliases: 'calabrese', score: 1 };
const STEAMED: LiveVariant = {
    id: 'V-steamed',
    rootId: 'R-broccoli',
    itemId: 'I-steamed',
    parts: [{ attribute: 'cookingMethod', ordinal: 0, text: 'steamed' }],
    nutrients: [],
};
const REUSED = '01JRETIREDBYNAME00000000R1';

describe('POST /foods and /foods/batch for a variant name (booted Nest, DAOs doubled)', () => {
    let created: CreateByNameResult;
    const createByName = vi.fn(async (_input: CreateByNameInput): Promise<CreateByNameResult> => created);
    const getById = vi.fn(async () => ({ id: REUSED, name: 'steamed broccoli', status: 'RESOLVED' }));
    const publishFoodRequested = vi.fn(async () => undefined);
    const publishFoodBatchRequested = vi.fn(async () => undefined);
    let api: MockedFoodsApi;

    beforeAll(async () => {
        api = await bootMockedFoodsApi({
            foodDao: { createByName, getById },
            searchDao: { searchCatalog: async () => [ROOT] },
            variants: { listLive: async () => [STEAMED] },
            enqueue: { publishFoodRequested, publishFoodBatchRequested },
        });
    });

    afterAll(async () => {
        await api.close();
    });

    beforeEach(() => {
        created = {
            id: REUSED,
            created: false,
            reactivated: false,
            forwardedTo: { kind: 'variant', id: 'V-steamed' },
        };
        createByName.mockClear();
        publishFoodRequested.mockClear();
        publishFoodBatchRequested.mockClear();
        mockVerify.mockReset();
        mockVerify.mockImplementation(async (token: string) => principalFor(token));
    });

    it('answers a reused retired root RESOLVED, naming the variant, queueing nothing', async () => {
        const res = await api.call('POST', '/api/v1/foods', { token: 'author', body: { name: 'steamed broccoli' } });

        expect(res.status).toBe(202);
        expect(addResponseSchema.parse(res.body)).toStrictEqual({
            id: REUSED,
            status: 'RESOLVED',
            forwardedTo: { kind: 'variant', id: 'V-steamed' },
        });
        expect(createByName).toHaveBeenCalledWith(
            expect.objectContaining({ forwardsTo: { kind: 'variant', id: 'V-steamed' } }),
        );
        expect(publishFoodRequested).not.toHaveBeenCalled();
    });

    it('answers the batch item inline, RESOLVED and named, queueing nothing', async () => {
        const res = await api.call('POST', '/api/v1/foods/batch', {
            token: 'author',
            body: { names: ['steamed broccoli'] },
        });

        expect(res.status).toBe(201);
        expect(batchResponseSchema.parse(res.body)).toStrictEqual({
            items: [
                {
                    id: REUSED,
                    status: 'RESOLVED',
                    name: 'steamed broccoli',
                    forwardedTo: { kind: 'variant', id: 'V-steamed' },
                },
            ],
        });
        expect(publishFoodBatchRequested).not.toHaveBeenCalled();
    });

    it('sends no forwardsTo for a name that is no variant, and queues it as before', async () => {
        created = { id: REUSED, created: true, reactivated: false };

        const res = await api.call('POST', '/api/v1/foods', { token: 'author', body: { name: 'kohlrabi' } });

        expect(addResponseSchema.parse(res.body)).toMatchObject({ id: REUSED, status: 'PENDING' });
        expect(createByName.mock.calls[0]?.[0]).not.toHaveProperty('forwardsTo');
        expect(publishFoodRequested).toHaveBeenCalledTimes(1);
    });
});
