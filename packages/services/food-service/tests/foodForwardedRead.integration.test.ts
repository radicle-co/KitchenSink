/**
 * `GET /api/v1/foods/{id}` and `GET /api/v1/foods/{id}/status` for a RETIRED root, over a real HTTP request with the
 * DAOs DOUBLED (§7.1a). Booted by `support/mockedFoodsApi.ts`: the real auth guard, pipe, controller, service, owner
 * reader and exception filter; no database.
 *
 * | Requirement (ADR-0050 §4; curated plan U8 S6) | Pinned here |
 * | --- | --- |
 * | a forwarded id serves the live end UNDER THE REQUESTED ID | `200`, the requested id, the target's numbers |
 * | the live entry is named | `forwardedTo`, and the body parses against the PUBLISHED schema |
 * | a variant target answers with the variant's own record | the DAO is read with that `variantId` |
 * | a broken chain answers the plain `404`, not the retired row's empty record | the body is the unknown id's |
 * | a live root is untouched | `forwardedTo` absent, and no forward is followed |
 *
 * What a real Postgres follows is `tests/e2e/foodsApi.e2e.test.ts`'s job.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@kitchensink/clerk-verify', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@kitchensink/clerk-verify')>();

    return { ...actual, verifyClerkToken: vi.fn() };
});

import { verifyClerkToken } from '@kitchensink/clerk-verify';

import { makeFoodRefFacts } from '../src/foods/__fixtures__/foodRefFacts.js';
import { makeGoldenFoodRecord } from '../src/foods/__fixtures__/goldenFoodRecord.js';
import type { FoodRefFacts, GoldenFoodRecord } from '../src/foods/dao/food.dao.js';
import type { ForwardOutcome } from '../src/foods/dao/foodForward.dao.js';
import type { VariantFacts } from '../src/foods/dao/foodVariant.dao.js';
import { foodErrorSchema, foodResponseSchema, statusResponseSchema } from '../src/foods/foods.schema.js';
import { bootMockedFoodsApi, principalFor, type MockedFoodsApi } from './support/mockedFoodsApi.js';

const mockVerify = vi.mocked(verifyClerkToken);

const RETIRED = `01J${'X'.repeat(21)}R1`;
const LIVE_ROOT = `01J${'X'.repeat(21)}R2`;
const LIVE_VARIANT = `01J${'X'.repeat(21)}V1`;

const nutrient = {
    nutrientId: 'n1',
    name: 'Energy',
    unit: 'kcal',
    infoodsTag: null,
    amount: '34',
    basis: 'per_100g',
    source: 'usda',
};

describe('GET /{id} and /{id}/status for a retired root (booted Nest, DAOs doubled)', () => {
    /** The golden records the doubled DAO answers, keyed `id` or `id#variantId`. */
    let records: Record<string, GoldenFoodRecord>;
    let roots: FoodRefFacts[];
    let variantRows: VariantFacts[];
    let end: ForwardOutcome | undefined;
    const readGoldenRecord = vi.fn(
        async (id: string, options?: { readonly variantId?: string }) =>
            records[options?.variantId === undefined ? id : `${id}#${options.variantId}`] ?? null,
    );
    const readRefFacts = vi.fn(async (ids: readonly string[]) => roots.filter((row) => ids.includes(row.id)));
    const readFacts = vi.fn(async (ids: readonly string[]) => variantRows.filter((row) => ids.includes(row.id)));
    const follow = vi.fn(
        async (ids: readonly string[]) => new Map(end === undefined ? [] : ids.map((id) => [id, end])),
    );
    let api: MockedFoodsApi;

    beforeAll(async () => {
        api = await bootMockedFoodsApi({
            foodDao: { readGoldenRecord, readRefFacts },
            variants: { listLive: async () => [], readFacts },
            forwards: { follow },
        });
    });

    afterAll(async () => {
        await api.close();
    });

    beforeEach(() => {
        records = {
            [RETIRED]: makeGoldenFoodRecord({ id: RETIRED, name: 'Broccoli', retired: true }),
            [LIVE_ROOT]: makeGoldenFoodRecord({ id: LIVE_ROOT, name: 'Broccoli, raw', nutrients: [nutrient] }),
            [`${LIVE_ROOT}#${LIVE_VARIANT}`]: makeGoldenFoodRecord({
                id: LIVE_ROOT,
                name: 'Broccoli, raw',
                nutrients: [{ ...nutrient, amount: '28' }],
            }),
        };
        roots = [makeFoodRefFacts({ id: RETIRED, retired: true }), makeFoodRefFacts({ id: LIVE_ROOT })];
        variantRows = [
            {
                id: LIVE_VARIANT,
                rootId: LIVE_ROOT,
                retired: false,
                parts: [{ attribute: 'cookingMethod', ordinal: 0, text: 'steamed' }],
            },
        ];
        end = { resolved: true, id: LIVE_ROOT, kind: 'root', hops: 1 };
        readGoldenRecord.mockClear();
        follow.mockClear();
        mockVerify.mockReset();
        mockVerify.mockImplementation(async (token: string) => principalFor(token));
    });

    it('serves a root forwarded to a live root under the requested id, naming the live root', async () => {
        const res = await api.call('GET', `/api/v1/foods/${RETIRED}`, { token: 'stranger' });

        expect(res.status).toBe(200);
        expect(foodResponseSchema.parse(res.body)).toMatchObject({
            id: RETIRED,
            name: 'Broccoli, raw',
            forwardedTo: { kind: 'root', id: LIVE_ROOT },
        });
        expect(foodResponseSchema.parse(res.body).nutrients).toHaveLength(1);
    });

    it("serves a root forwarded to a live variant with the variant's own numbers", async () => {
        end = { resolved: true, id: LIVE_VARIANT, kind: 'variant', hops: 1 };

        const res = await api.call('GET', `/api/v1/foods/${RETIRED}`, { token: 'stranger' });

        expect(res.status).toBe(200);
        expect(readGoldenRecord).toHaveBeenCalledWith(LIVE_ROOT, { variantId: LIVE_VARIANT });
        expect(foodResponseSchema.parse(res.body)).toMatchObject({
            id: RETIRED,
            forwardedTo: { kind: 'variant', id: LIVE_VARIANT },
            variants: [],
        });
        expect(foodResponseSchema.parse(res.body).nutrients[0]?.amount).toBe(28);
    });

    it('serves /status with the requested id on the envelope and on the food, naming the live root', async () => {
        const res = await api.call('GET', `/api/v1/foods/${RETIRED}/status`, { token: 'stranger' });

        expect(res.status).toBe(200);
        expect(statusResponseSchema.parse(res.body)).toMatchObject({
            id: RETIRED,
            status: 'RESOLVED',
            food: { id: RETIRED, forwardedTo: { kind: 'root', id: LIVE_ROOT } },
        });
    });

    it('answers the unknown id’s plain 404 when the chain is broken, on both routes', async () => {
        end = { resolved: false, reason: 'cycle' };
        const broken = await api.call('GET', `/api/v1/foods/${RETIRED}`, { token: 'stranger' });
        const brokenStatus = await api.call('GET', `/api/v1/foods/${RETIRED}/status`, { token: 'stranger' });
        records = {};
        const unknown = await api.call('GET', `/api/v1/foods/${RETIRED}`, { token: 'stranger' });

        expect(broken.status).toBe(404);
        expect(brokenStatus.status).toBe(404);
        expect(foodErrorSchema.parse(broken.body).code).toBe('FOOD_NOT_FOUND');
        expect(broken.text).toBe(unknown.text);
    });

    it('follows no forward for a live root and publishes no forwardedTo', async () => {
        const res = await api.call('GET', `/api/v1/foods/${LIVE_ROOT}`, { token: 'stranger' });

        expect(res.status).toBe(200);
        expect(foodResponseSchema.parse(res.body).forwardedTo).toBeUndefined();
        expect(follow).not.toHaveBeenCalled();
    });
});
