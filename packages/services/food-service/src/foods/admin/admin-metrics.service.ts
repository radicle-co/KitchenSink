/**
 * `AdminMetricsService` (T-184) — composes the operational signals the admin dashboard reads (FR-039 /
 * US-10): `fetch_queue` depths, the food lifecycle backlog (UNRESOLVED / NOT_FOUND / FAILED), and each
 * wired source's trailing-60-min rolling-window utilization. Read-only; it never mutates state and never
 * calls a source.
 *
 * @implements FR-039
 */
import { Injectable } from '@nestjs/common';

import { RollingWindowLimiter } from '../../sources/rolling-window-limiter.js';
import { AdminMetricsDao } from './admin-metrics.dao.js';
// AUTHORED wire contract (CODING_STANDARDS §15.2), published via `@kitchensink/schema-food`. Re-exported so
// this module's historical import sites keep working, but no longer DEFINED here.
export type { OperationalMetrics, SourceWindowMetrics } from './admin-metrics.schema.js';
import type { OperationalMetrics, QueueDepthMetrics, SourceWindowMetrics } from './admin-metrics.schema.js';

@Injectable()
export class AdminMetricsService {
    public constructor(
        private readonly dao: AdminMetricsDao,
        private readonly limiter: RollingWindowLimiter,
    ) {}

    /**
     * Collect the full operational-metrics payload (FR-039/US-10).
     *
     * @returns Queue depths, lifecycle backlog, and per-source window utilization.
     * @sideEffect Reads `fetch_queue`, `food`, and `source_call_log` (via the limiter).
     */
    public async collect(): Promise<OperationalMetrics> {
        const [queue, backlog, sources] = await Promise.all([
            this.dao.queueDepths(),
            this.dao.backlog(),
            this.sourceWindows(),
        ]);

        return { queue, backlog, sources };
    }

    /**
     * The `fetch_queue` depth signals on their own (the focused `/admin/queue` endpoint).
     *
     * @returns The pending / in-flight / tombstone depths.
     * @sideEffect Reads `fetch_queue`.
     */
    public async queueDepths(): Promise<QueueDepthMetrics> {
        return this.dao.queueDepths();
    }

    /** Per-source trailing-60-min window utilization for every wired source. */
    private async sourceWindows(): Promise<SourceWindowMetrics[]> {
        return Promise.all(
            this.limiter.knownSources().map(async (source) => {
                const [windowCount, paused] = await Promise.all([
                    this.limiter.count(source),
                    this.limiter.isPaused(source),
                ]);
                const caps = this.limiter.capsFor(source);
                const utilization = caps.hardCap > 0 ? Math.min(windowCount / caps.hardCap, 1) : 0;

                return {
                    source,
                    windowCount,
                    hardCap: caps.hardCap,
                    pauseThreshold: caps.pauseThreshold,
                    utilization,
                    paused,
                };
            }),
        );
    }
}
