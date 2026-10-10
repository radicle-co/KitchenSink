/**
 * `POST /api/v1/foods/{id}/refetch` over a real HTTP request, with the DAOs and the queue DOUBLED (§7.1a). Booted by
 * `support/mockedFoodsApi.ts`.
 *
 * A food the seed owns has one writer, the seed (KTD-12), so the operator's re-enqueue refuses it with the `409` the
 * route already answers for a withdrawn food. The live food beside it is the positive control: same status, so
 * ownership is the only difference.
 *
 * What a real Postgres does — which rows a refused or admitted refetch leaves — is
 * `tests/e2e/foodsApi.e2e.test.ts`'s job.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@kitchensink/clerk-verify', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@kitchensink/clerk-verify')>();

    return { ...actual, verifyClerkToken: vi.fn() };
});

import { verifyClerkToken } from '@kitchensink/clerk-verify';

import { addResponseSchema, foodErrorSchema } from '../src/foods/foods.schema.js';
import { bootMockedFoodsApi, OPERATOR_ID, principalFor, type MockedFoodsApi } from './support/mockedFoodsApi.js';

const mockVerify = vi.mocked(verifyClerkToken);

const SEED_ROOT_ID = '01JQZK8N7QF3B2X4M6T0V5C0SD';
const LIVE_FOOD_ID = '01JQZK8N7QF3B2X4M6T0V5C0VE';

describe('POST /api/v1/foods/{id}/refetch — a seed-owned food is never queued (booted Nest, DAOs doubled)', () => {
    const getById = vi.fn(async (id: string) => ({ id, status: 'RESOLVED' }));
    const isSeedOwned = vi.fn(async (id: string) => id === SEED_ROOT_ID);
    const publishFoodRequested = vi.fn(async () => undefined);
    let api: MockedFoodsApi;

    beforeAll(async () => {
        api = await bootMockedFoodsApi({
            foodDao: { getById, isSeedOwned },
            enqueue: { publishFoodRequested },
        });
    });

    afterAll(async () => {
        await api.close();
    });

    beforeEach(() => {
        publishFoodRequested.mockClear();
        mockVerify.mockReset();
        mockVerify.mockImplementation(async (token: string) => principalFor(token));
    });

    it('⛔ answers 409 NOT_REQUEUEABLE for a seed-owned food, and queues nothing', async () => {
        const res = await api.call('POST', `/api/v1/foods/${SEED_ROOT_ID}/refetch`, { token: 'operator' });

        expect(res.status).toBe(409);
        expect(foodErrorSchema.parse(res.body)).toStrictEqual({
            code: 'NOT_REQUEUEABLE',
            message: expect.stringContaining('seed'),
            details: { id: SEED_ROOT_ID, status: 'RESOLVED' },
        });
        expect(publishFoodRequested).not.toHaveBeenCalled();
    });

    it('answers 202 for a live food in the same status, and queues it (positive control)', async () => {
        const res = await api.call('POST', `/api/v1/foods/${LIVE_FOOD_ID}/refetch`, { token: 'operator' });

        expect(res.status).toBe(202);
        expect(addResponseSchema.parse(res.body)).toMatchObject({ id: LIVE_FOOD_ID, status: 'RESOLVED' });
        expect(publishFoodRequested).toHaveBeenCalledExactlyOnceWith({
            id: LIVE_FOOD_ID,
            requestedBy: OPERATOR_ID,
            reactivate: true,
        });
    });
});
