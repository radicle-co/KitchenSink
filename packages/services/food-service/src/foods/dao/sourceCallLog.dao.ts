/**
 * `SourceCallLogDao` (T-110, MOD-005) — the per-source rolling call ledger and the admission it backs (ADR-0053 §2,
 * §5). {@link SourceCallLogDao.admit} is one transaction: it takes the per-source advisory lock, refuses while the
 * source's block is live, and otherwise records the call only when the source's trailing count is under the ceiling.
 * The lock makes the read and the insert serial, so concurrent tasks can never push a window past its ceiling
 * (SC-002), and the block is read under the same lock, so a block one task wrote refuses every task.
 *
 * The window and the ceilings are the caller's: `RollingWindowLimiter` reads them from the source register (with any
 * override applied) and picks the ceiling for the caller's lane, so USDA counts per hour.
 *
 * **The `channel` lane (F-W1, migration `0010`).** Every row records which lane spent it. Admission counts twice: every
 * lane's calls against the source's ceiling, and the caller's own lane's calls against that lane's ceiling (the
 * worker's share, owner 2026-10-02). ⛔ The first count is never narrowed by lane: both lanes spend one budget, and a
 * lane counted alone could take its own full ceiling on top of the other's.
 *
 * @pattern Repository — the one writer of `source_call_log`
 * @implements FR-019 FR-020 FR-026
 */
import { sql, type SQL } from 'drizzle-orm';

import { ADVISORY_LOCK_CLASSES } from '@kitchensink/db-schema-guard';

import type { FoodDrizzle } from '../../database/database.module.js';
import { localTimeout } from '../../database/localTimeout.js';
import type { CallableApiSourceId } from '../../sources/sourceRegister.js';
import type { Admission, SourceCallChannel } from '../../sources/transport/transportPorts.js';
import { isLockNotAvailable } from './dao.errors.js';

/** How long admission waits for the per-source lock before answering `contended`, in milliseconds. */
export const ADMISSION_LOCK_TIMEOUT_MS = 2_000;

/** The longest any one statement after the lock may run, in milliseconds. Each one measures under 1 ms. */
export const ADMISSION_STATEMENT_TIMEOUT_MS = 500;

/**
 * The statements admission runs under `statement_timeout` on its longest path, the ceiling refusal: the block read, the
 * insert, the age-out read and `COMMIT`. The e2e suite counts them against the real statements.
 */
export const ADMISSION_TIMED_STATEMENTS = 4;

/** How long after the end of a contended lock wait a retry is worth making, in milliseconds. */
export const CONTENDED_RETRY_MS = 1_000;

/*
 * Admission's time bound. It runs inside the source client's request deadline and ignores the caller's abort signal,
 * so its worst case must end before that deadline (`sourceCallLog.dao.test.ts` asserts it):
 *
 *     FOOD_POOL_CONNECT_TIMEOUT_MS + ADMISSION_LOCK_TIMEOUT_MS
 *         + ADMISSION_TIMED_STATEMENTS × ADMISSION_STATEMENT_TIMEOUT_MS  <  USDA_REQUEST_TIMEOUT_MS
 *
 * `statement_timeout` is set only once the lock is granted: in force during the wait, it would cancel the wait (57014)
 * before `lock_timeout` could answer `contended`. The control statements outside both timeouts (BEGIN, the two SETs,
 * SAVEPOINT, RELEASE, and on the contended path ROLLBACK TO SAVEPOINT, the clock read and COMMIT) read no table.
 * `transaction_timeout` is not used: it ends the session, not the transaction.
 *
 * Both are set with `localTimeout`, so both end with the transaction.
 *
 * The block write (`SourceBackoffDao.record`) runs after the source answered, on its own connection, and ignores the
 * abort signal too. It cannot fit inside the deadline admission already spent, so its bound is that a stalled ledger
 * holds a call for less than one more deadline (the same unit test asserts it):
 *
 *     FOOD_POOL_CONNECT_TIMEOUT_MS + RECORD_TIMED_STATEMENTS × RECORD_STATEMENT_TIMEOUT_MS  <  USDA_REQUEST_TIMEOUT_MS
 *
 * Its row-lock wait sits inside its upsert, so `RECORD_LOCK_TIMEOUT_MS` is below `RECORD_STATEMENT_TIMEOUT_MS` rather
 * than added to it. The pool's `query_timeout` is a backstop under both bounds, never part of either.
 */
const LOCK_TIMEOUT = localTimeout('lock_timeout', ADMISSION_LOCK_TIMEOUT_MS);
const STATEMENT_TIMEOUT = localTimeout('statement_timeout', ADMISSION_STATEMENT_TIMEOUT_MS);

/** Input for {@link SourceCallLogDao.admit}. */
export interface AdmitInput {
    /** The source whose window is charged. */
    readonly source: CallableApiSourceId;
    /** The lane spending the call. Recorded, and the lane whose own calls `laneCeiling` bounds. */
    readonly lane: SourceCallChannel;
    /** The most calls the window may hold, every lane counted. */
    readonly ceiling: number;
    /**
     * The most calls the window may hold from `lane` alone. The call is recorded only while both counts are under
     * their ceilings.
     */
    readonly laneCeiling: number;
    /** The source's trailing window, in seconds. */
    readonly windowSeconds: number;
}

/** A source's window as the admin metrics read it. */
export interface WindowStatus {
    /** Calls inside the trailing window, per lane. A `Record` over the lanes, so a new lane must be counted. */
    readonly byLane: Readonly<Record<SourceCallChannel, number>>;
    /** Whether {@link SourceCallLogDao.admit} with the same input would refuse now: a live block, or a full count. */
    readonly paused: boolean;
}

/**
 * Whether a window's counts leave room for one more call: every lane's calls under `ceiling` and the lane's own calls
 * under `laneCeiling`. Admission records a call only under it, and the admin metrics read a window as paused when it
 * does not hold, so the two read one rule.
 *
 * @param spent - The derived table holding the window's `every_lane` and `own_lane` counts.
 * @param ceiling - The most calls the window may hold, every lane counted.
 * @param laneCeiling - The most calls the window may hold from the lane alone.
 * @returns The condition.
 */
function underCeilings(spent: SQL, ceiling: number, laneCeiling: number): SQL {
    return sql`(${spent}.every_lane < ${ceiling} AND ${spent}.own_lane < ${laneCeiling})`;
}

/**
 * An epoch-milliseconds reading from the database as ISO 8601. Pure.
 *
 * @param milliseconds - The reading.
 * @returns The instant.
 */
function isoOf(milliseconds: number): string {
    return new Date(milliseconds).toISOString();
}

export class SourceCallLogDao {
    /** @param db - The food-schema Drizzle client. */
    public constructor(private readonly db: FoodDrizzle) {}

    /**
     * Admit one call to `source`, recording it on `lane` when admitted.
     *
     * In one READ COMMITTED transaction: bound the lock wait, take the per-source advisory lock, bound every later
     * statement, refuse while the source's block is live, then insert the call only while every lane's calls are
     * under `ceiling` and `lane`'s own calls are under `laneCeiling`.
     *
     * ⚠️ The lock key is `source` alone, never `(source, lane)`: two lanes holding two locks while counting the same
     * rows would each read a pre-insert count and both admit.
     *
     * @param input - The source, the lane, the two ceilings and the window.
     * @returns Admitted (and recorded), or refused with the reason and the earliest retry by the database clock:
     *   `blocked` until the block ends, `ceiling` until enough calls age out for both counts, `contended`
     *   {@link CONTENDED_RETRY_MS} after the lock wait ended.
     * @throws Any database failure, including a statement cancelled by `statement_timeout`, unchanged; the transport
     *   reports it as its own.
     * @sideEffect Takes a transaction-scoped advisory lock; may insert into `source_call_log`.
     */
    public async admit(input: AdmitInput): Promise<Admission> {
        const { source, lane, ceiling, laneCeiling, windowSeconds } = input;
        const window = sql`make_interval(secs => ${windowSeconds}::int)`;

        // ⛔ READ COMMITTED is named, never inherited from the session. The count must see every call committed
        // before the lock was granted; a REPEATABLE READ snapshot is taken before the lock, so every waiter counts a
        // stale window and admits past the ceiling.
        return this.db.transaction(
            async (tx): Promise<Admission> => {
                await tx.execute(LOCK_TIMEOUT);

                try {
                    // In a savepoint, so a lock not granted in time aborts only the savepoint, and the transaction
                    // can still read the clock after the wait.
                    await tx.transaction(async (savepoint) => {
                        await savepoint.execute(
                            sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_CLASSES.foodSourceLimiter}, hashtext(${source}))`,
                        );
                    });
                } catch (error) {
                    if (!isLockNotAvailable(error)) {
                        throw error;
                    }

                    // `clock_timestamp()`, not `now()`: `now()` is the transaction's start, before the wait.
                    const clock = await tx.execute<{ ms: number }>(
                        sql`SELECT (extract(epoch FROM clock_timestamp()) * 1000)::float8 AS ms`,
                    );
                    const waitEnded = clock.rows[0]?.ms;

                    if (waitEnded === undefined) {
                        throw new Error('Source admission: the database clock returned no row.', { cause: error });
                    }

                    return { admitted: false, reason: 'contended', retryAt: isoOf(waitEnded + CONTENDED_RETRY_MS) };
                }

                await tx.execute(STATEMENT_TIMEOUT);

                // The admission instant: one clock reading, taken after the lock and used for the block, the count,
                // the stamp and the age-out. `clock_timestamp()`, not `now()`, which is the transaction's start and
                // so before the wait; a call stamped then leaves its window early by the length of the wait. Read as
                // text and bound back, which round-trips exactly. The CTE runs once, since the function is volatile.
                const block = await tx.execute<{ at: string; ms: number | null }>(sql`
                    WITH clock AS (SELECT clock_timestamp() AS at)
                    SELECT clock.at::text AS at,
                           (SELECT (extract(epoch FROM blocked_until) * 1000)::float8
                              FROM source_backoff
                             WHERE source = ${source}::food_source AND blocked_until > clock.at) AS ms
                      FROM clock
                `);
                const reading = block.rows[0];

                if (reading === undefined) {
                    throw new Error('Source admission: the database clock returned no row.');
                }

                if (reading.ms !== null) {
                    return { admitted: false, reason: 'blocked', retryAt: isoOf(reading.ms) };
                }

                const at = sql`${reading.at}::timestamptz`;
                const ownLane = sql`channel = ${lane}::source_call_channel`;
                const inserted = await tx.execute(sql`
                    INSERT INTO source_call_log (source, channel, called_at)
                    SELECT ${source}::food_source, ${lane}::source_call_channel, ${at}
                      FROM (
                          SELECT count(*) AS every_lane, count(*) FILTER (WHERE ${ownLane}) AS own_lane
                            FROM source_call_log
                           WHERE source = ${source}::food_source AND called_at > ${at} - ${window}
                      ) AS spent
                     WHERE ${underCeilings(sql`spent`, ceiling, laneCeiling)}
                    RETURNING id
                `);

                if ((inserted.rowCount ?? 0) === 1) {
                    return { admitted: true };
                }

                // Each count holds `count` calls and admits below its ceiling, so `count − ceiling + 1` of its calls
                // must age out: the call at that position, oldest first, decides. A count under its ceiling waits for
                // nothing, and both must be under theirs, so the later moment is the answer. Under a ceiling of 0 no
                // wait frees a place, so the answer is the admission instant, never the process's clock. One
                // statement, so the bound on admission's statements holds.
                const ageOut = await tx.execute<{ ms: number }>(sql`
                    WITH counted AS (
                        SELECT called_at, channel FROM source_call_log
                         WHERE source = ${source}::food_source AND called_at > ${at} - ${window}
                    ), own AS (
                        SELECT called_at FROM counted WHERE ${ownLane}
                    )
                    SELECT (extract(epoch FROM greatest(
                        CASE WHEN (SELECT count(*) FROM counted) >= ${ceiling} THEN coalesce(
                            (SELECT called_at + ${window}
                               FROM counted
                              ORDER BY called_at
                             OFFSET greatest((SELECT count(*) FROM counted) - ${ceiling}, 0)
                              LIMIT 1),
                            ${at}
                        ) ELSE ${at} END,
                        CASE WHEN (SELECT count(*) FROM own) >= ${laneCeiling} THEN coalesce(
                            (SELECT called_at + ${window}
                               FROM own
                              ORDER BY called_at
                             OFFSET greatest((SELECT count(*) FROM own) - ${laneCeiling}, 0)
                              LIMIT 1),
                            ${at}
                        ) ELSE ${at} END
                    )) * 1000)::float8 AS ms
                `);
                const freesAt = ageOut.rows[0]?.ms;

                if (freesAt === undefined) {
                    throw new Error('Source admission: the age-out read returned no row.');
                }

                return { admitted: false, reason: 'ceiling', retryAt: isoOf(freesAt) };
            },
            { isolationLevel: 'read committed' },
        );
    }

    /**
     * A source's trailing counts, and whether admitting `input` would refuse now, for the admin metrics. Nothing is
     * locked or recorded, so a concurrent admission may change the answer the moment it is read.
     *
     * @param input - The admission the status answers for: the source, the lane, the two ceilings and the window.
     * @returns The count per lane, and whether the window is paused for the lane.
     * @throws {Error} when the read returns no row; any database failure unchanged.
     * @sideEffect Reads `source_call_log` and `source_backoff`.
     */
    public async windowStatus(input: AdmitInput): Promise<WindowStatus> {
        const { source, lane, ceiling, laneCeiling, windowSeconds } = input;
        const result = await this.db.execute<{ interactive: number; worker: number; paused: boolean }>(sql`
            SELECT spent.interactive,
                   spent.worker,
                   (EXISTS (SELECT 1 FROM source_backoff
                             WHERE source = ${source}::food_source AND blocked_until > now())
                    OR NOT ${underCeilings(sql`spent`, ceiling, laneCeiling)}) AS paused
              FROM (
                  SELECT count(*) FILTER (WHERE channel = 'interactive')::int AS interactive,
                         count(*) FILTER (WHERE channel = 'worker')::int AS worker,
                         count(*) AS every_lane,
                         count(*) FILTER (WHERE channel = ${lane}::source_call_channel) AS own_lane
                    FROM source_call_log
                   WHERE source = ${source}::food_source
                     AND called_at > now() - make_interval(secs => ${windowSeconds}::int)
              ) AS spent
        `);
        const row = result.rows[0];

        if (row === undefined) {
            throw new Error('Source window status: the read returned no row.');
        }

        return { byLane: { interactive: row.interactive, worker: row.worker }, paused: row.paused };
    }

    /**
     * Delete every call older than `horizonSeconds`, across all sources, so the ledger stays bounded (REQ-020).
     * `<`, not `<=`, so a row exactly at the edge is kept: the prune never removes a row a window still counts.
     *
     * @param horizonSeconds - The longest window any source counts.
     * @returns The number of pruned rows.
     * @sideEffect Deletes from `source_call_log`.
     */
    public async pruneAged(horizonSeconds: number): Promise<number> {
        const result = await this.db.execute(sql`
            DELETE FROM source_call_log
             WHERE called_at < now() - make_interval(secs => ${horizonSeconds}::int)
        `);

        return result.rowCount ?? 0;
    }
}
