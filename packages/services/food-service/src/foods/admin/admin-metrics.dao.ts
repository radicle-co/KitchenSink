/**
 * `AdminMetricsDao` (T-184, MOD-001) — the read-only operational-signal queries backing the admin
 * dashboard endpoints (FR-039/US-10). Two grouped aggregate reads: `fetch_queue` depth by operational
 * status, and `food` lifecycle backlog by status. No mutation — these are pure operational reads.
 *
 * @implements FR-039
 */
import { sql } from 'drizzle-orm';

import type { FoodDrizzle } from '../../database/database.module.js';

/** `fetch_queue` depth by operational status (FR-046 backpressure / FR-018 lease signals). */
export interface QueueDepthMetrics {
    /** Rows awaiting a drain. */
    pending: number;
    /** Rows currently leased to the worker. */
    inFlight: number;
    /** Terminal (DLQ-equivalent) rows — NOT_FOUND / FAILED foods. */
    tombstone: number;
}

/** `food` lifecycle backlog counts (DSN-9 keeps NOT_FOUND distinct from the alarmed FAILED). */
export interface BacklogMetrics {
    /** Foods awaiting a human disambiguation pick (FR-RES-1). */
    unresolved: number;
    /** Foods no wired source has (a normal, non-alarmed outcome, DSN-9). */
    notFound: number;
    /** Foods whose every source errored past the retry budget (the alarmed signal, FR-016). */
    failed: number;
}

export class AdminMetricsDao {
    public constructor(private readonly db: FoodDrizzle) {}

    /**
     * Count `fetch_queue` rows grouped by operational status.
     *
     * @returns The pending / in-flight / tombstone depths (zeroed when the queue is empty).
     * @sideEffect Reads `fetch_queue`.
     */
    public async queueDepths(): Promise<QueueDepthMetrics> {
        const result = await this.db.execute<{ status: string; n: number }>(sql`
            SELECT status, count(*)::int AS n FROM fetch_queue GROUP BY status
        `);
        const by = new Map(result.rows.map((row) => [row.status, row.n]));

        return {
            pending: by.get('pending') ?? 0,
            inFlight: by.get('in_flight') ?? 0,
            tombstone: by.get('tombstone') ?? 0,
        };
    }

    /**
     * Count `food` rows in the UNRESOLVED / NOT_FOUND / FAILED lifecycle states.
     *
     * @returns The backlog counts (zeroed when none).
     * @sideEffect Reads `food`.
     */
    public async backlog(): Promise<BacklogMetrics> {
        const result = await this.db.execute<{ status: string; n: number }>(sql`
            SELECT status, count(*)::int AS n FROM food
             WHERE status IN ('UNRESOLVED', 'NOT_FOUND', 'FAILED')
             GROUP BY status
        `);
        const by = new Map(result.rows.map((row) => [row.status, row.n]));

        return {
            unresolved: by.get('UNRESOLVED') ?? 0,
            notFound: by.get('NOT_FOUND') ?? 0,
            failed: by.get('FAILED') ?? 0,
        };
    }
}
