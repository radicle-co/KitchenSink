/**
 * Unit tests for {@link FoodsService} — the read-path branching matrix (mocked repo + queue).
 *
 * Requirement → test mapping:
 * - FR-001/FR-002 (cache hit)        → "fetched & fresh returns the food (200 path)"
 * - FR-031 (stale-while-revalidate)  → "stale record serves data + enqueues background re-fetch"
 * - FR-005/FR-025 (tombstone in TTL) → "not_found within TTL throws FoodNotFoundError (404 path)"
 * - FR-025 (tombstone TTL lapsed)    → "not_found past TTL enqueues + throws FoodPendingError"
 * - FR-003/FR-004 (cache miss)       → "missing food enqueues + throws FoodPendingError (202 path)"
 * - FR-003 (pending)                 → "pending food enqueues + throws FoodPendingError"
 * - FR-007/FR-033 (status)           → "getStatus returns correct shapes per lifecycle"
 * - FR-002 (nutrients)               → "getNutrients returns full breakdown incl. nulls; 404 if unfetched"
 * - FR-008/FR-009/FR-010 (search)    → "search trims, returns ranked results, empty on blank/no-match"
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FetchQueueService } from '../fetch-queue.service.js';
import { isFoodNotFoundError, isFoodPendingError } from '../foods.errors.js';
import { FoodsRepository } from '../foods.repository.js';
import { FoodsService } from '../foods.service.js';
import { makeFoodRow } from '../__fixtures__/foods.fixtures.js';

const DAY_MS = 86_400_000;

function makeService(): {
    service: FoodsService;
    repo: {
        findByFdcId: ReturnType<typeof vi.fn>;
        search: ReturnType<typeof vi.fn>;
        autocomplete: ReturnType<typeof vi.fn>;
    };
    queue: { publishFoodRequested: ReturnType<typeof vi.fn>; publishFoodBatchRequested: ReturnType<typeof vi.fn> };
} {
    const repo = {
        findByFdcId: vi.fn(),
        search: vi.fn(),
        autocomplete: vi.fn(),
    };
    const queue = {
        publishFoodRequested: vi.fn().mockResolvedValue(undefined),
        publishFoodBatchRequested: vi.fn().mockResolvedValue(undefined),
    };
    const service = new FoodsService(repo as unknown as FoodsRepository, queue as unknown as FetchQueueService);

    return { service, repo, queue };
}

describe('FoodsService.getFood', () => {
    let ctx: ReturnType<typeof makeService>;

    beforeEach(() => {
        ctx = makeService();
    });

    it('returns the food without enqueuing for a fresh fetched row (FR-001/FR-002)', async () => {
        ctx.repo.findByFdcId.mockResolvedValue(makeFoodRow({ fetchedAt: new Date() }));

        const result = await ctx.service.getFood(171688, 'user_1');

        expect(result.fdcId).toBe(171688);
        expect(result.fetchStatus).toBe('fetched');
        expect(result.nutrients.calories).toBe(58);
        expect(result.stale).toBeUndefined();
        expect(ctx.queue.publishFoodRequested).not.toHaveBeenCalled();
    });

    it('serves stale data with stale:true and enqueues a background re-fetch (FR-031 SWR)', async () => {
        const old = new Date(Date.now() - 40 * DAY_MS);
        ctx.repo.findByFdcId.mockResolvedValue(makeFoodRow({ fetchStatus: 'fetched', fetchedAt: old }));

        const result = await ctx.service.getFood(171688, 'user_1');

        expect(result.fetchStatus).toBe('stale');
        expect(result.stale).toBe(true);
        expect(ctx.queue.publishFoodRequested).toHaveBeenCalledTimes(1);
    });

    it('serves an explicit stale row as 200 + enqueues (FR-031)', async () => {
        ctx.repo.findByFdcId.mockResolvedValue(makeFoodRow({ fetchStatus: 'stale', fetchedAt: new Date() }));

        const result = await ctx.service.getFood(171688, 'user_1');

        expect(result.stale).toBe(true);
        expect(ctx.queue.publishFoodRequested).toHaveBeenCalledTimes(1);
    });

    it('throws FoodNotFoundError for a tombstone within TTL, with no enqueue (FR-005/FR-025)', async () => {
        ctx.repo.findByFdcId.mockResolvedValue(
            makeFoodRow({ fetchStatus: 'not_found', fetchedAt: null, updatedAt: new Date() }),
        );

        await expect(ctx.service.getFood(999999, 'user_1')).rejects.toSatisfy(isFoodNotFoundError);
        expect(ctx.queue.publishFoodRequested).not.toHaveBeenCalled();
    });

    it('enqueues a re-attempt and throws FoodPendingError for a tombstone past TTL (FR-025)', async () => {
        const old = new Date(Date.now() - 40 * DAY_MS);
        ctx.repo.findByFdcId.mockResolvedValue(
            makeFoodRow({ fetchStatus: 'not_found', fetchedAt: null, updatedAt: old }),
        );

        await expect(ctx.service.getFood(999999, 'user_1')).rejects.toSatisfy(isFoodPendingError);
        expect(ctx.queue.publishFoodRequested).toHaveBeenCalledTimes(1);
    });

    it('enqueues and throws FoodPendingError for a missing food (FR-003/FR-004 → 202)', async () => {
        ctx.repo.findByFdcId.mockResolvedValue(null);

        await expect(ctx.service.getFood(171688, 'user_1')).rejects.toSatisfy((e: unknown) => {
            return isFoodPendingError(e) && e.fdcId === 171688 && e.estimatedWaitSeconds === 30;
        });
        expect(ctx.queue.publishFoodRequested).toHaveBeenCalledWith(
            expect.objectContaining({ fdcId: 171688, requestedBy: 'user_1' }),
        );
    });

    it('enqueues and throws FoodPendingError for a pending food (FR-003)', async () => {
        ctx.repo.findByFdcId.mockResolvedValue(makeFoodRow({ fetchStatus: 'pending' }));

        await expect(ctx.service.getFood(171688, 'user_1')).rejects.toSatisfy(isFoodPendingError);
        expect(ctx.queue.publishFoodRequested).toHaveBeenCalledTimes(1);
    });
});

describe('FoodsService.getStatus', () => {
    let ctx: ReturnType<typeof makeService>;

    beforeEach(() => {
        ctx = makeService();
    });

    it('throws FoodNotFoundError when no record exists (FR-007)', async () => {
        ctx.repo.findByFdcId.mockResolvedValue(null);

        await expect(ctx.service.getStatus(171688)).rejects.toSatisfy(isFoodNotFoundError);
    });

    it('returns the full food for a fetched record (FR-007)', async () => {
        ctx.repo.findByFdcId.mockResolvedValue(makeFoodRow({ fetchedAt: new Date() }));

        const result = await ctx.service.getStatus(171688);

        expect(result.status).toBe('fetched');
        expect(result.food?.fdcId).toBe(171688);
    });

    it('returns pending + estimatedWaitSeconds for a pending record (FR-033)', async () => {
        ctx.repo.findByFdcId.mockResolvedValue(makeFoodRow({ fetchStatus: 'pending' }));

        const result = await ctx.service.getStatus(171688);

        expect(result.status).toBe('pending');
        expect(result.estimatedWaitSeconds).toBe(20);
        expect(result.food).toBeUndefined();
    });

    it('returns not_found for a tombstoned record without food (FR-007)', async () => {
        ctx.repo.findByFdcId.mockResolvedValue(makeFoodRow({ fetchStatus: 'not_found' }));

        const result = await ctx.service.getStatus(171688);

        expect(result.status).toBe('not_found');
        expect(result.food).toBeUndefined();
    });

    it('never enqueues from a status poll (FR-033)', async () => {
        ctx.repo.findByFdcId.mockResolvedValue(makeFoodRow({ fetchStatus: 'pending' }));

        await ctx.service.getStatus(171688);

        expect(ctx.queue.publishFoodRequested).not.toHaveBeenCalled();
    });
});

describe('FoodsService.getNutrients', () => {
    let ctx: ReturnType<typeof makeService>;

    beforeEach(() => {
        ctx = makeService();
    });

    it('returns the full breakdown including null micros (FR-002)', async () => {
        ctx.repo.findByFdcId.mockResolvedValue(makeFoodRow({ fetchedAt: new Date(), ironMg: null }));

        const result = await ctx.service.getNutrients(171688);

        expect(result.nutrients).toHaveProperty('ironMg', null);
        expect(result.nutrients).toHaveProperty('calciumMg', 6);
        expect(result.nutrients.calories).toBe(58);
    });

    it('throws FoodNotFoundError when the food is not yet fetched (FR-002)', async () => {
        ctx.repo.findByFdcId.mockResolvedValue(makeFoodRow({ fetchStatus: 'pending' }));

        await expect(ctx.service.getNutrients(171688)).rejects.toSatisfy(isFoodNotFoundError);
    });
});

describe('FoodsService.search / autocomplete', () => {
    let ctx: ReturnType<typeof makeService>;

    beforeEach(() => {
        ctx = makeService();
    });

    it('returns an empty list for a blank query without hitting the repo (FR-009)', async () => {
        const result = await ctx.service.search('   ');

        expect(result.foods).toEqual([]);
        expect(ctx.repo.search).not.toHaveBeenCalled?.();
        expect(ctx.repo.search).not.toHaveBeenCalled();
    });

    it('delegates ranked results from the repository (FR-008/FR-010)', async () => {
        ctx.repo.search.mockResolvedValue([{ fdcId: 1, description: 'Chicken breast', dataType: 'SR Legacy' }]);

        const result = await ctx.service.search('chicken breast');

        expect(result.foods).toHaveLength(1);
        expect(ctx.repo.search).toHaveBeenCalledWith('chicken breast');
    });

    it('returns empty suggestions for a blank autocomplete query', async () => {
        const result = await ctx.service.autocomplete('');

        expect(result.suggestions).toEqual([]);
    });
});
