/**
 * `AdminMetricsDao` (T-184, MOD-001) — the read-only operational-signal queries backing the admin
 * dashboard endpoints (FR-039/US-10). Two grouped aggregate reads: `fetch_queue` depth by operational
 * status, and `food` lifecycle backlog by status. No mutation — these are pure operational reads.
 *
 * @implements FR-039
 */
import { sql } from 'drizzle-orm';

import type { FoodDrizzle } from '../../database/database.module.js';
import type { BacklogMetrics, QueueDepthMetrics } from './adminMetrics.schema.js';

// The wire shapes these queries fill are AUTHORED in `adminMetrics.schema.ts` and published via
// `@kitchensink/schema-food`. They are re-exported here so the DAO's historical import sites keep working,
// but the DAO is deliberately no longer where they are DEFINED: a data-access module defining a response
// body is the leak CODING_STANDARDS §15.2 exists to close.
export type { BacklogMetrics, QueueDepthMetrics } from './adminMetrics.schema.js';

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
