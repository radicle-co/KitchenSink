/**
 * The READ side of the admin surface (FR-039 / US-10): the operational signals the dashboard polls.
 *
 * @implements FR-039
 */
import { Injectable } from '@nestjs/common';

import { RollingWindowLimiter } from '../../sources/RollingWindowLimiter.js';
import { AdminMetricsDao } from './adminMetrics.dao.js';
// AUTHORED wire contract (CODING_STANDARDS §15.2), published via `@kitchensink/schema-food`. Re-exported so
// this module's historical import sites keep working, but no longer DEFINED here.
export type { OperationalMetrics, SourceWindowMetrics } from './adminMetrics.schema.js';
import type { OperationalMetrics, QueueDepthMetrics, SourceWindowMetrics } from './adminMetrics.schema.js';

/**
 * The operational-metrics query model (FR-039/US-10): `fetch_queue` depths, the food lifecycle backlog
 * (UNRESOLVED / NOT_FOUND / FAILED), and each wired source's trailing-60-min rolling-window utilization.
 *
 * DESIGN PATTERN: **Query model** — the read half of the CQRS split with `FoodRecoveryService`. It never
 * mutates state and never calls a source, which is why it holds no write-side DAO: U9's requeue lived here
 * and made that sentence false.
 */
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
