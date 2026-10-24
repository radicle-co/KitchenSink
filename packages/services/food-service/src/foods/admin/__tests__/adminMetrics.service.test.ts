/**
 * Unit tests for {@link AdminMetricsService} (T-184) — the operational-signal composition over a fake
 * {@link AdminMetricsDao} and the real {@link RollingWindowLimiter} over a fake call ledger. Pins the pure assembly + the
 * per-source window-utilization math; the real DB counts are covered by
 * `tests/adminMetrics.integration.test.ts`, the HTTP scope gate by the controller suite + e2e.
 *
 * Requirement → test mapping:
 * - FR-039 / US-10 → exposes queue depths, UNRESOLVED backlog, tombstone-row counts, per-source
 *   trailing-60-min window utilization for the operations dashboard.
 *
 * U9's operator requeue was covered here while it lived on this service. It moved to
 * `FoodRecoveryService`, and its cases moved with it to `foodRecovery.service.test.ts` — nothing was
 * dropped. This service is read-only again, which is why its constructor no longer takes the two
 * write-side DAOs.
 */
import { describe, expect, it } from 'vitest';

import type { AdminMetricsDao } from '../adminMetrics.dao.js';
import { AdminMetricsService } from '../adminMetrics.service.js';
import type { WindowStatus } from '../../dao/sourceCallLog.dao.js';
import { RollingWindowLimiter } from '../../../sources/RollingWindowLimiter.js';

function fakeDao(): AdminMetricsDao {
    return {
        queueDepths: async () => ({ pending: 7, inFlight: 2, tombstone: 3 }),
        backlog: async () => ({ unresolved: 4, notFound: 5, failed: 1 }),
    } as unknown as AdminMetricsDao;
}

/** The real limiter at USDA's declared 1,000/hr, over a ledger reporting `status` for every source. */
function limiterReporting(status: WindowStatus): RollingWindowLimiter {
    return new RollingWindowLimiter(
        {
            admit: async () => ({ admitted: true }),
            windowStatus: async () => status,
            pruneAged: async () => 0,
        },
        {},
    );
}

/** One wired source `usda` at 450/1000 in the window, 150 of them live, not paused. */
function fakeLimiter(): RollingWindowLimiter {
    return limiterReporting({ byLane: { interactive: 150, worker: 300 }, paused: false });
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
                workerWindowCount: 300,
                hardCap: 1000,
                pauseThreshold: 600,
                utilization: 0.45,
                paused: false,
            },
        ]);
    });

    // The worker's own calls stop at its share of the ceiling while live calls are still admitted, and `paused` is
    // the worker's.
    it('reports utilization as windowCount / hardCap and flags the paused state at the worker’s share', async () => {
        const metrics = await new AdminMetricsService(
            fakeDao(),
            limiterReporting({ byLane: { interactive: 0, worker: 600 }, paused: true }),
        ).collect();

        expect(metrics.sources[0]).toMatchObject({ windowCount: 600, utilization: 0.6, paused: true });
    });

    it('reports the worker running while live calls alone take the window past its share', async () => {
        const metrics = await new AdminMetricsService(
            fakeDao(),
            limiterReporting({ byLane: { interactive: 500, worker: 200 }, paused: false }),
        ).collect();

        expect(metrics.sources[0]).toMatchObject({ windowCount: 700, workerWindowCount: 200, paused: false });
    });

    it('flags a source under a live block as paused below its ceiling (ADR-0053 §5)', async () => {
        const metrics = await new AdminMetricsService(
            fakeDao(),
            limiterReporting({ byLane: { interactive: 0, worker: 3 }, paused: true }),
        ).collect();

        expect(metrics.sources[0]).toMatchObject({ windowCount: 3, paused: true });
    });
});

describe('AdminMetricsService.queueDepths', () => {
    it('returns the fetch_queue depth signals (pending / in-flight / tombstone)', async () => {
        const service = new AdminMetricsService(fakeDao(), fakeLimiter());

        expect(await service.queueDepths()).toEqual({ pending: 7, inFlight: 2, tombstone: 3 });
    });
});
