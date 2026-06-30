/**
 * Unit tests for {@link AdminMetricsService} (T-184) — the operational-signal composition over a fake
 * {@link AdminMetricsDao} and a fake {@link RollingWindowLimiter}. Pins the pure assembly + the
 * per-source window-utilization math; the real DB counts are covered by
 * `tests/admin-metrics.integration.test.ts`, the HTTP scope gate by the controller suite + e2e.
 *
 * Requirement → test mapping:
 * - FR-039 / US-10 → exposes queue depths, UNRESOLVED backlog, tombstone-row counts, per-source
 *   trailing-60-min window utilization for the operations dashboard.
 */
import { describe, expect, it } from 'vitest';

import type { AdminMetricsDao } from '../admin-metrics.dao.js';
import { AdminMetricsService } from '../admin-metrics.service.js';
import type { RollingWindowLimiter } from '../../../sources/rolling-window-limiter.js';
import type { FoodSourceId } from '../../../sources/food-source-adapter.js';

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
        const service = new AdminMetricsService(fakeDao(), fakeLimiter());

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

        const metrics = await new AdminMetricsService(fakeDao(), limiter).collect();

        expect(metrics.sources[0]).toMatchObject({ windowCount: 900, utilization: 0.9, paused: true });
    });
});

describe('AdminMetricsService.queueDepths', () => {
    it('returns the fetch_queue depth signals (pending / in-flight / tombstone)', async () => {
        const service = new AdminMetricsService(fakeDao(), fakeLimiter());

        expect(await service.queueDepths()).toEqual({ pending: 7, inFlight: 2, tombstone: 3 });
    });
});
