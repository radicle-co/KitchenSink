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
import { AdminMetricsDao, type BacklogMetrics, type QueueDepthMetrics } from './admin-metrics.dao.js';

/** A wired source's trailing-60-min window utilization signal. */
export interface SourceWindowMetrics {
    /** Source id (e.g. `usda`). */
    source: string;
    /** Calls recorded in the trailing 60 minutes (FR-019/FR-020). */
    windowCount: number;
    /** The source's hard cap (the absolute ceiling). */
    hardCap: number;
    /** The 90% pause threshold the worker self-throttles at. */
    pauseThreshold: number;
    /** `windowCount / hardCap`, clamped to `[0, 1]`. */
    utilization: number;
    /** Whether the worker is currently paused on this source (count ≥ threshold or 429 failsafe). */
    paused: boolean;
}

/** The aggregate operational-metrics payload for the dashboard. */
export interface OperationalMetrics {
    /** `fetch_queue` depths by operational status. */
    queue: QueueDepthMetrics;
    /** Food lifecycle backlog counts. */
    backlog: BacklogMetrics;
    /** Per-wired-source rolling-window utilization. */
    sources: SourceWindowMetrics[];
}

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
