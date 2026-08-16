/**
 * Unit tests for {@link AdminMetricsService} (T-184) — the operational-signal composition over a fake
 * {@link AdminMetricsDao} and a fake {@link RollingWindowLimiter}. Pins the pure assembly + the
 * per-source window-utilization math; the real DB counts are covered by
 * `tests/adminMetrics.integration.test.ts`, the HTTP scope gate by the controller suite + e2e.
 *
 * Requirement → test mapping:
 * - FR-039 / US-10 → exposes queue depths, UNRESOLVED backlog, tombstone-row counts, per-source
 *   trailing-60-min window utilization for the operations dashboard.
 * - U9 / R2.4 → the operator requeue writes BOTH halves in the documented order, is idempotent for a food
 *   that is already pending, and reports an unknown id as `FoodNotFoundError` rather than a `500`. The
 *   same paths against the real schema are `tests/retryLifecycle.integration.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest';

import type { AdminMetricsDao } from '../adminMetrics.dao.js';
import { AdminMetricsService } from '../adminMetrics.service.js';
import { IllegalStatusTransitionError } from '../../dao/dao.errors.js';
import { isFoodNotFoundError } from '../../foods.errors.js';
import type { RollingWindowLimiter } from '../../../sources/RollingWindowLimiter.js';
import type { FoodSourceId } from '../../../sources/foodSourceAdapter.js';

/** U9 requeue collaborators — this suite exercises the metrics paths, which never touch them. */
const foodDaoDouble = { setStatus: async () => undefined } as never;
const queueDouble = { reactivate: async () => undefined } as never;

function fakeDao(): AdminMetricsDao {
    return {
        queueDepths: async () => ({ pending: 7, inFlight: 2, tombstone: 3 }),
        backlog: async () => ({ unresolved: 4, notFound: 5, failed: 1 }),
    } as unknown as AdminMetricsDao;
}

/** A fake limiter: one wired source `usda` at 450/1000 in the window, not yet paused. */
function fakeLimiter(): RollingWindowLimiter {
    return {
        knownSources: (): FoodSourceId[] => ['usda'],
        count: async (_source: FoodSourceId) => 450,
        capsFor: (_source: FoodSourceId) => ({ hardCap: 1000, pauseThreshold: 900 }),
        isPaused: async (_source: FoodSourceId) => false,
    } as unknown as RollingWindowLimiter;
}

describe('AdminMetricsService.collect', () => {
    it('composes queue depths, backlog, and per-source window utilization', async () => {
        const service = new AdminMetricsService(fakeDao(), fakeLimiter(), foodDaoDouble, queueDouble);

        const metrics = await service.collect();

        expect(metrics.queue).toEqual({ pending: 7, inFlight: 2, tombstone: 3 });
        expect(metrics.backlog).toEqual({ unresolved: 4, notFound: 5, failed: 1 });
        expect(metrics.sources).toEqual([
            {
                source: 'usda',
                windowCount: 450,
                hardCap: 1000,
                pauseThreshold: 900,
                utilization: 0.45,
                paused: false,
            },
        ]);
    });

    it('reports utilization as windowCount / hardCap and flags the paused state', async () => {
        const limiter = {
            knownSources: (): FoodSourceId[] => ['usda'],
            count: async () => 900,
            capsFor: () => ({ hardCap: 1000, pauseThreshold: 900 }),
            isPaused: async () => true,
        } as unknown as RollingWindowLimiter;

        const metrics = await new AdminMetricsService(fakeDao(), limiter, foodDaoDouble, queueDouble).collect();

        expect(metrics.sources[0]).toMatchObject({ windowCount: 900, utilization: 0.9, paused: true });
    });
});

describe('AdminMetricsService.queueDepths', () => {
    it('returns the fetch_queue depth signals (pending / in-flight / tombstone)', async () => {
        const service = new AdminMetricsService(fakeDao(), fakeLimiter(), foodDaoDouble, queueDouble);

        expect(await service.queueDepths()).toEqual({ pending: 7, inFlight: 2, tombstone: 3 });
    });
});

describe('AdminMetricsService.requeueFood (U9 — the way back from a blackholed food)', () => {
    /**
     * A `FoodDao` double that enforces the real FR-028a rule for `→ PENDING`: legal only from `FAILED`,
     * `NOT_FOUND` and `AWAITING_RETRY`. Stating the rule (rather than a canned resolve/reject) is what lets
     * these tests distinguish "handled the rejection" from "never provoked one".
     */
    function fakeFoodDao(status: string | undefined, trace: string[] = []): never {
        const legalPriors = new Set(['FAILED', 'NOT_FOUND', 'AWAITING_RETRY']);

        return {
            setStatus: async ({ id }: { id: string }) => {
                trace.push('setStatus');

                if (status === undefined || !legalPriors.has(status)) {
                    throw new IllegalStatusTransitionError(id, 'PENDING');
                }

                return { id, status: 'PENDING' };
            },
            getById: async (id: string) => {
                trace.push('getById');

                return status === undefined ? undefined : { id, status };
            },
        } as never;
    }

    /** A `FetchQueueDao` double recording that (and when) the queue half ran. */
    function fakeQueue(trace: string[] = []): never {
        return {
            reactivate: async () => {
                trace.push('reactivate');
            },
        } as never;
    }

    it('clears the lifecycle mark BEFORE the queue half, so a mid-failure leaves the food retryable', async () => {
        const trace: string[] = [];
        const service = new AdminMetricsService(
            fakeDao(),
            fakeLimiter(),
            fakeFoodDao('FAILED', trace),
            fakeQueue(trace),
        );

        await expect(service.requeueFood('food-1')).resolves.toStrictEqual({ id: 'food-1', status: 'PENDING' });

        expect(trace).toStrictEqual(['setStatus', 'reactivate']);
    });

    it.each(['NOT_FOUND', 'AWAITING_RETRY'])('recovers a food resting in %s', async (status) => {
        const trace: string[] = [];
        const service = new AdminMetricsService(fakeDao(), fakeLimiter(), fakeFoodDao(status, trace), fakeQueue(trace));

        await expect(service.requeueFood('food-1')).resolves.toMatchObject({ status: 'PENDING' });
        expect(trace).toStrictEqual(['setStatus', 'reactivate']);
    });

    it('is idempotent for an already-PENDING food — and STILL runs the queue half', async () => {
        const trace: string[] = [];
        const service = new AdminMetricsService(
            fakeDao(),
            fakeLimiter(),
            fakeFoodDao('PENDING', trace),
            fakeQueue(trace),
        );

        await expect(service.requeueFood('food-1')).resolves.toStrictEqual({ id: 'food-1', status: 'PENDING' });

        // The rejected write is classified by a read, then the queue half runs anyway: an operator whose
        // first call already reset the lifecycle must still get the attempt count cleared.
        expect(trace).toStrictEqual(['setStatus', 'getById', 'reactivate']);
    });

    it('reports an unknown id as FoodNotFoundError (404) and never touches the queue for a food that is absent', async () => {
        const trace: string[] = [];
        const service = new AdminMetricsService(
            fakeDao(),
            fakeLimiter(),
            fakeFoodDao(undefined, trace),
            fakeQueue(trace),
        );

        await expect(service.requeueFood('missing')).rejects.toSatisfy(isFoodNotFoundError);
        expect(trace).not.toContain('reactivate');
    });

    it('re-raises the illegal transition for a RESOLVED food — a healthy food is not requeued into the drain', async () => {
        const trace: string[] = [];
        const service = new AdminMetricsService(
            fakeDao(),
            fakeLimiter(),
            fakeFoodDao('RESOLVED', trace),
            fakeQueue(trace),
        );

        await expect(service.requeueFood('food-1')).rejects.toBeInstanceOf(IllegalStatusTransitionError);
        expect(trace).not.toContain('reactivate');
    });

    it('does not swallow a non-transition failure from the lifecycle write', async () => {
        const boom = new Error('connection terminated');
        const foodDao = { setStatus: vi.fn().mockRejectedValue(boom), getById: vi.fn() } as never;
        const service = new AdminMetricsService(fakeDao(), fakeLimiter(), foodDao, fakeQueue());

        await expect(service.requeueFood('food-1')).rejects.toBe(boom);
    });
});
