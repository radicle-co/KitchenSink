/**
 * `SourceCallLogDao` (T-110, MOD-005) — the per-source rolling-60-min call ledger. `checkAndRecord`
 * is an atomic count-and-record: it records a call only when the trailing-60-min count for that
 * source is strictly under the cap, and reports whether the call is allowed. A transaction-scoped
 * per-source advisory lock serializes the check+insert so the window can NEVER overshoot the cap
 * under concurrency (the SC-002 "≤cap in any rolling-60-min window" guarantee), independent of the
 * single-worker assumption. `pruneAged` drops rows strictly older than the window — conservative, so
 * it never under-counts the limiter (TST-5).
 *
 * @implements FR-019 FR-020
 */
import { sql } from 'drizzle-orm';

import type { FoodDrizzle } from '../../database/database.module.js';
import type { FoodSource } from './food-sources.dao.js';

/** The trailing window length (60 minutes, FR-019/FR-020). */
const WINDOW = sql`interval '3600 seconds'`;

/** Two-int advisory-lock classid for the per-source limiter (DSN-15) — distinct from drainer/dedup. */
const LOCK_CLASS_LIMITER = 3;

/** Input for {@link SourceCallLogDao.checkAndRecord}. */
export interface CheckAndRecordInput {
    /** The source whose window is being charged. */
    source: FoodSource;
    /** The source's hard cap for the trailing window. */
    cap: number;
}

/** Result of {@link SourceCallLogDao.checkAndRecord}. */
export interface WindowCheckResult {
    /** `true` when the call was recorded (strictly under the cap). */
    allowed: boolean;
    /** The trailing-60-min count for the source after the attempt. */
    windowCount: number;
}

export class SourceCallLogDao {
    public constructor(private readonly db: FoodDrizzle) {}

    /**
     * Atomically record a call for `source` iff its trailing-60-min count is strictly under `cap`
     * (REQ-020). A per-source advisory lock makes the count+insert serial, so concurrent callers can
     * never push the window past the cap.
     *
     * @param input - The source and its hard cap.
     * @returns Whether the call was allowed, plus the post-attempt trailing count.
     * @sideEffect Takes a transaction-scoped advisory lock; may insert into `source_call_log`.
     */
    public async checkAndRecord(input: CheckAndRecordInput): Promise<WindowCheckResult> {
        const { source, cap } = input;

        return this.db.transaction(async (tx) => {
            await tx.execute(sql`SELECT pg_advisory_xact_lock(${LOCK_CLASS_LIMITER}, hashtext(${source}))`);

            const inserted = await tx.execute(sql`
                INSERT INTO source_call_log (source, called_at)
                SELECT ${source}::food_source, now()
                WHERE (
                    SELECT count(*) FROM source_call_log
                     WHERE source = ${source}::food_source AND called_at > now() - ${WINDOW}
                ) < ${cap}
                RETURNING id
            `);

            const counted = await tx.execute<{ n: number }>(sql`
                SELECT count(*)::int AS n FROM source_call_log
                 WHERE source = ${source}::food_source AND called_at > now() - ${WINDOW}
            `);

            return { allowed: (inserted.rowCount ?? 0) === 1, windowCount: counted.rows[0]?.n ?? 0 };
        });
    }

    /**
     * Count a source's calls inside the trailing 60-minute window.
     *
     * @param source - The source.
     * @returns The trailing-60-min call count.
     * @sideEffect Reads `source_call_log`.
     */
    public async countInWindow(source: FoodSource): Promise<number> {
        const result = await this.db.execute<{ n: number }>(sql`
            SELECT count(*)::int AS n FROM source_call_log
             WHERE source = ${source}::food_source AND called_at > now() - ${WINDOW}
        `);

        return result.rows[0]?.n ?? 0;
    }

    /**
     * Prune call rows strictly older than the trailing window so the ledger stays bounded (REQ-020).
     * Uses `<` (not `<=`) so a row exactly at the window edge is retained — the prune never removes a
     * row the limiter still counts, so it cannot under-count the window (TST-5).
     *
     * @param source - The source whose aged rows to drop.
     * @returns The number of pruned rows.
     * @sideEffect Deletes from `source_call_log`.
     */
    public async pruneAged(source: FoodSource): Promise<number> {
        const result = await this.db.execute(sql`
            DELETE FROM source_call_log
             WHERE source = ${source}::food_source AND called_at < now() - ${WINDOW}
        `);

        return result.rowCount ?? 0;
    }
}
