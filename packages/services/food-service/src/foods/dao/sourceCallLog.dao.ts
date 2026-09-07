/**
 * `SourceCallLogDao` (T-110, MOD-005) — the per-source rolling-60-min call ledger. `checkAndRecord`
 * is an atomic count-and-record: it records a call only when the trailing-60-min count for that
 * source is strictly under the cap, and reports whether the call is allowed. A transaction-scoped
 * per-source advisory lock serializes the check+insert so the window can NEVER overshoot the cap
 * under concurrency (the SC-002 "≤cap in any rolling-60-min window" guarantee), independent of the
 * single-worker assumption. `pruneAged` drops rows strictly older than the window — conservative, so
 * it never under-counts the limiter (TST-5), and lane-blind, because the window it bounds is the source's.
 *
 * **The `channel` lane (F-W1, migration `0010`).** Every row records which lane spent it —
 * {@link SourceCallChannel} — so the reserved user-facing headroom FR-019 describes is both ENFORCED (the
 * caller's cap differs by lane) and OBSERVABLE (the ledger can say who spent what). ⛔ The lane never
 * narrows the admission COUNT — see {@link SourceCallLogDao.checkAndRecord}.
 *
 * @implements FR-019 FR-020
 */
import { sql, type SQL } from 'drizzle-orm';

import { settingFromEnv } from '../../config/env.schema.js';
import type { FoodDrizzle } from '../../database/database.module.js';
import type { FoodSource } from './foodSources.dao.js';

/** Two-int advisory-lock classid for the per-source limiter (DSN-15) — distinct from drainer/dedup. */
const LOCK_CLASS_LIMITER = 3;

/**
 * Which lane a source call is charged to (F-W1). Mirrors the `source_call_channel` enum
 * (`db/schema/operational.ts`, migration `0010`).
 *
 * ⛔ Two lanes, ONE budget: both spend the same per-source window, because USDA rate-limits our egress
 * IP. The lane decides only how far into that window its caller may push the SHARED count.
 */
export type SourceCallChannel = 'interactive' | 'worker';

/** Input for {@link SourceCallLogDao.checkAndRecord}. */
export interface CheckAndRecordInput {
    /** The source whose window is being charged. */
    source: FoodSource;
    /**
     * The lane spending the call. **Required, deliberately** — a default would let a new call site charge
     * whichever lane happened to be convenient, which is precisely the drift the ledger exists to detect.
     * Making it mandatory turned every pre-existing caller into a compile error that had to declare itself.
     */
    channel: SourceCallChannel;
    /**
     * The caller's ceiling for the trailing window. ⚠️ This is the LANE's cap, not the source's hard cap:
     * `RollingWindowLimiter` (`sources/RollingWindowLimiter.ts`) passes the 90% pause threshold for `worker` and the hard cap for
     * `interactive`. The COUNT it is compared against is still the whole window's — see the class doc.
     */
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
    /**
     * The trailing window this DAO counts and prunes over, as a SQL interval (default 3,600s = 60 min,
     * FR-019/FR-020 — the default lives ONCE, in `FOOD_SOURCE_WINDOW_SECONDS`). Configurable so a preview
     * can use a short window to observe the rate-limit stall→resume under load without waiting a full hour
     * for calls to age out; prod leaves the default, so the emitted SQL is unchanged there.
     *
     * Resolved per instance rather than at module load: a malformed value must fail where the operator can
     * attribute it (constructing this DAO), not as an import-time crash in whatever module happens to pull
     * the file in first — and a frozen module constant made the knob unobservable to any test.
     */
    private readonly window: SQL;

    /** @param db - The food-schema Drizzle client. */
    public constructor(private readonly db: FoodDrizzle) {
        this.window = sql`make_interval(secs => ${settingFromEnv('FOOD_SOURCE_WINDOW_SECONDS')})`;
    }

    /**
     * Atomically record a call for `source` on `channel`, iff the source's trailing-60-min count — across
     * **both** lanes — is strictly under `cap` (REQ-020). A per-source advisory lock makes the count+insert
     * serial, so concurrent callers can never push the window past the cap.
     *
     * ⛔ **The count is aggregate; only the CAP is per-lane** (F-W1). USDA rate-limits our egress IP, so both
     * lanes spend one budget: narrowing the count to `WHERE channel = $channel` would give each lane its own
     * full cap and let the two together reach 2x the key's real limit, an SC-002 breach that reads as
     * perfectly correct in isolation. The lane's only effect is which ceiling the caller may push that ONE
     * count to — see `RollingWindowLimiter` (`sources/RollingWindowLimiter.ts`) for the two ceilings and why they differ.
     *
     * ⚠️ The advisory lock key is `source` alone, NOT `(source, channel)`. Keying it per-lane would let two
     * lanes hold different locks while counting the same rows, so each could read a pre-insert count and both
     * admit — reintroducing the overshoot the lock exists to prevent, on the exact mixed-lane traffic this
     * split creates.
     *
     * @param input - The source, the lane spending the call, and that lane's cap.
     * @returns Whether the call was allowed, plus the post-attempt trailing count (both lanes).
     * @sideEffect Takes a transaction-scoped advisory lock; may insert into `source_call_log`.
     */
    public async checkAndRecord(input: CheckAndRecordInput): Promise<WindowCheckResult> {
        const { source, channel, cap } = input;

        return this.db.transaction(async (tx) => {
            await tx.execute(sql`SELECT pg_advisory_xact_lock(${LOCK_CLASS_LIMITER}, hashtext(${source}))`);

            const inserted = await tx.execute(sql`
                INSERT INTO source_call_log (source, channel, called_at)
                SELECT ${source}::food_source, ${channel}::source_call_channel, now()
                WHERE (
                    SELECT count(*) FROM source_call_log
                     WHERE source = ${source}::food_source AND called_at > now() - ${this.window}
                ) < ${cap}
                RETURNING id
            `);

            const counted = await tx.execute<{ n: number }>(sql`
                SELECT count(*)::int AS n FROM source_call_log
                 WHERE source = ${source}::food_source AND called_at > now() - ${this.window}
            `);

            return { allowed: (inserted.rowCount ?? 0) === 1, windowCount: counted.rows[0]?.n ?? 0 };
        });
    }

    /**
     * Count a source's calls inside the trailing 60-minute window.
     *
     * @param source - The source.
     * @param channel - Narrow the count to ONE lane. Omit for the whole window, which is what every
     *   admission and pause decision reads — the aggregate is the quota-relevant number. A lane's own count
     *   is an OBSERVABILITY read (admin metrics, "did the drain eat the reserve last hour?"), and it must
     *   never be substituted for the aggregate in a cap comparison.
     * @returns The trailing-60-min call count.
     * @sideEffect Reads `source_call_log`.
     */
    public async countInWindow(source: FoodSource, channel?: SourceCallChannel): Promise<number> {
        const result = await this.db.execute<{ n: number }>(sql`
            SELECT count(*)::int AS n FROM source_call_log
             WHERE source = ${source}::food_source
               AND called_at > now() - ${this.window}
               AND (${channel ?? null}::source_call_channel IS NULL OR channel = ${channel ?? null}::source_call_channel)
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
             WHERE source = ${source}::food_source AND called_at < now() - ${this.window}
        `);

        return result.rowCount ?? 0;
    }
}
