/**
 * LOCAL e2e (CODING_STANDARDS §7.1a): admission and the shared block on a real Postgres, the guarantees only a
 * real database can show (ADR-0053 §2, §5, plan U27):
 *
 * - two pools, standing in for two tasks, admitting at once never pass the ceiling together;
 * - with both lanes admitting at once, the worker never passes its share of the window and live calls still fill it
 *   to the ceiling (owner, 2026-10-02; `WORKER_WINDOW_SHARE` in `sourceCeiling.ts`);
 * - live calls do not count toward the worker's share, and a refused call is told the later of the moments its own
 *   lane and the whole window free a place;
 * - a block one pool writes refuses the other pool's admission;
 * - a lock not granted within `lock_timeout` answers `contended`, with a retry instant after the wait, and records
 *   nothing;
 * - an admitted call is stamped with the database clock after the lock wait, not the transaction's start;
 * - admission pins READ COMMITTED, so a session defaulting to REPEATABLE READ still never passes the ceiling;
 * - every statement after the lock runs under `statement_timeout`, and neither timeout leaks into the pool;
 * - concurrent block writes keep the latest end;
 * - a block write that meets a held row lock fails at `lock_timeout` rather than waiting, and its statements run under
 *   `statement_timeout`, so a stalled ledger cannot hold a source call past the bound `sourceCallLog.dao.ts` states;
 * - a source's window comes from the register, so USDA's calls age out after its hour;
 * - `pruneAged` keeps every row inside the longest declared window and deletes the rest;
 * - the admin metrics' `paused` reads the same rule admission inserts under.
 *
 * Every connection is `food_app`, the role a deployed task holds. This file took over the real-database coverage of
 * the deleted `tests/sourceCallLog.dao.integration.test.ts` and `tests/RollingWindowLimiter.integration.test.ts`
 * (the integration tier mocks its database, owner ruling 2026-09-20).
 */
import { setTimeout as sleep } from 'node:timers/promises';

import type { Logger } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ADVISORY_LOCK_CLASSES } from '@kitchensink/db-schema-guard';

import * as schema from '../../src/db/schema/index.js';
import { FOOD_POOL_CONNECT_TIMEOUT_MS } from '../../src/database/poolConfig.js';
import {
    RECORD_LOCK_TIMEOUT_MS,
    RECORD_STATEMENT_TIMEOUT_MS,
    RECORD_TIMED_STATEMENTS,
    SourceBackoffDao,
} from '../../src/foods/dao/sourceBackoff.dao.js';
import {
    ADMISSION_LOCK_TIMEOUT_MS,
    ADMISSION_TIMED_STATEMENTS,
    CONTENDED_RETRY_MS,
    SourceCallLogDao,
} from '../../src/foods/dao/sourceCallLog.dao.js';
import { PRUNE_HORIZON_SECONDS, RollingWindowLimiter } from '../../src/sources/RollingWindowLimiter.js';
import type { SourceCallChannel } from '../../src/sources/transport/transportPorts.js';
import { sourceCeiling, workerCeiling } from '../../src/sources/transport/sourceCeiling.js';
import { foodDb } from '../support/roleDb.js';

/** One task's connection: its own pool and its own DAOs over it. */
interface Task {
    readonly pool: pg.Pool;
    readonly calls: SourceCallLogDao;
    readonly blocks: SourceBackoffDao;
}

/** How a test opens a task's pool. */
interface TaskOptions {
    /** The pool's size. */
    readonly max?: number;
    /** A startup `options` string, such as `-c name=value`, applied to every connection. */
    readonly options?: string;
    /** Receives every statement Drizzle sends. */
    readonly logger?: Logger;
}

/**
 * Open one task's pool as `food_app`.
 *
 * @param options - The pool's size, startup options and statement logger.
 * @returns The task.
 * @sideEffect Opens a pool.
 */
function openTask(options: TaskOptions = {}): Task {
    const pool = new pg.Pool({
        connectionString: foodDb().appUrl,
        max: options.max ?? 10,
        ...(options.options === undefined ? {} : { options: options.options }),
    });
    const db = drizzle(pool, { schema, ...(options.logger === undefined ? {} : { logger: options.logger }) });

    return { pool, calls: new SourceCallLogDao(db), blocks: new SourceBackoffDao(db) };
}

/**
 * The SQLSTATE a thrown value carries, on itself or on one of its causes.
 *
 * @param error - The thrown value.
 * @returns The code, or `undefined` when none is found.
 */
function sqlStateOf(error: unknown): string | undefined {
    let candidate: unknown = error;

    for (let depth = 0; depth < 5 && typeof candidate === 'object' && candidate !== null; depth += 1) {
        if ('code' in candidate && typeof candidate.code === 'string') {
            return candidate.code;
        }

        candidate = 'cause' in candidate ? candidate.cause : undefined;
    }

    return undefined;
}

/**
 * The session's lock and statement timeouts and its isolation, as one pooled connection reports them.
 *
 * @param pool - A pool of one connection.
 * @returns The three settings.
 * @sideEffect Reads session settings.
 */
async function sessionSettings(pool: pg.Pool): Promise<Record<string, string>> {
    const result = await pool.query<Record<string, string>>(
        `SELECT current_setting('statement_timeout') AS statement_timeout,
                current_setting('lock_timeout') AS lock_timeout,
                current_setting('transaction_isolation') AS transaction_isolation`,
    );

    return result.rows[0] ?? {};
}

/**
 * Hold the limiter lock for `source` on a separate session while `run` runs.
 *
 * @param source - The source whose lock is held.
 * @param run - What runs while the lock is held.
 * @returns What `run` returns.
 * @sideEffect Opens a connection and takes a session advisory lock.
 */
async function whileLimiterLocked<T>(source: string, run: () => Promise<T>): Promise<T> {
    const holder = new pg.Client({ connectionString: foodDb().appUrl });
    await holder.connect();

    try {
        await holder.query('SELECT pg_advisory_lock($1, hashtext($2))', [
            ADVISORY_LOCK_CLASSES.foodSourceLimiter,
            source,
        ]);

        return await run();
    } finally {
        await holder.end();
    }
}

/**
 * Count a source's rows in the call log, regardless of age.
 *
 * @param pool - A pool.
 * @param source - The source.
 * @returns The count.
 * @sideEffect Reads `source_call_log`.
 */
async function rowsFor(pool: pg.Pool, source: string): Promise<number> {
    const result = await pool.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM source_call_log WHERE source = $1::food_source',
        [source],
    );

    return result.rows[0]?.n ?? 0;
}

/**
 * Insert call-log rows a given number of seconds in the past.
 *
 * @param pool - A pool.
 * @param source - The source.
 * @param secondsAgo - How old each row is.
 * @param lane - The lane that spent each row.
 * @sideEffect Writes `source_call_log`.
 */
async function insertAged(
    pool: pg.Pool,
    source: string,
    secondsAgo: readonly number[],
    lane: SourceCallChannel = 'worker',
): Promise<void> {
    for (const age of secondsAgo) {
        await pool.query(
            `INSERT INTO source_call_log (source, channel, called_at)
             VALUES ($1::food_source, $3::source_call_channel, now() - make_interval(secs => $2::int))`,
            [source, age, lane],
        );
    }
}

/**
 * The database's clock, epoch milliseconds.
 *
 * @param pool - A pool.
 * @returns The time.
 * @sideEffect Reads the database clock.
 */
async function databaseNow(pool: pg.Pool): Promise<number> {
    const result = await pool.query<{ ms: number }>('SELECT (extract(epoch FROM now()) * 1000)::float8 AS ms');

    return result.rows[0]?.ms ?? Number.NaN;
}

describe('source admission and the shared block (real Postgres)', () => {
    let first: Task;
    let second: Task;

    beforeAll(() => {
        first = openTask();
        second = openTask();
    });

    afterAll(async () => {
        await first?.pool.end();
        await second?.pool.end();
    });

    beforeEach(async () => {
        await foodDb().truncate();
    });

    it('never admits past the ceiling when two tasks admit at once', async () => {
        const ceiling = 9;
        const attempts = Array.from({ length: 40 }, async (_, index) =>
            (index % 2 === 0 ? first : second).calls.admit({
                source: 'usda',
                lane: index % 3 === 0 ? 'interactive' : 'worker',
                ceiling,
                laneCeiling: ceiling,
                windowSeconds: 3600,
            }),
        );

        const admissions = await Promise.all(attempts);

        expect(admissions.filter((admission) => admission.admitted)).toHaveLength(ceiling);
        expect(await rowsFor(first.pool, 'usda')).toBe(ceiling);
        expect(admissions.every((admission) => admission.admitted || admission.reason === 'ceiling')).toBe(true);
    });

    it('holds the worker to its share and the window to its ceiling when both lanes admit at once', async () => {
        // Through the limiter, as every caller is admitted. The worker's attempts are sent first and alone outnumber
        // the ceiling, so a worker held only to the ceiling would take the whole window. Live attempts also outnumber
        // it, so the window fills to the ceiling whatever order the lock grants them in.
        const overrides = { usda: { requests: 15, windowSeconds: 3600 } } as const;
        const ceiling = sourceCeiling(overrides.usda.requests);
        const left = new RollingWindowLimiter(first.calls, overrides);
        const right = new RollingWindowLimiter(second.calls, overrides);
        const lanes = [
            ...Array.from({ length: 2 * ceiling }, () => 'worker' as const),
            ...Array.from({ length: 2 * ceiling }, () => 'interactive' as const),
        ];

        const admissions = await Promise.all(
            lanes.map(async (lane, index) => (index % 2 === 0 ? left : right).admit('usda', lane)),
        );
        const { rows } = await first.pool.query<{ channel: string; n: number }>(
            `SELECT channel, count(*)::int AS n FROM source_call_log GROUP BY channel`,
        );
        const spent = new Map(rows.map((row) => [row.channel, row.n]));

        expect((spent.get('worker') ?? 0) + (spent.get('interactive') ?? 0)).toBe(ceiling);
        expect(spent.get('worker') ?? 0).toBeLessThanOrEqual(workerCeiling(ceiling));
        expect(admissions.filter((admission) => admission.admitted)).toHaveLength(ceiling);
        expect(admissions.every((admission) => admission.admitted || admission.reason === 'ceiling')).toBe(true);
    });

    // Owner, 2026-10-02: the worker's own calls stay under its share and every lane's calls stay under the ceiling.
    it('admits a worker call while live calls alone fill more than its share, the window under the ceiling', async () => {
        await insertAged(first.pool, 'usda', [100, 200, 300, 400, 500], 'interactive');

        const admission = await second.calls.admit({
            source: 'usda',
            lane: 'worker',
            ceiling: 9,
            laneCeiling: 3,
            windowSeconds: 3600,
        });

        expect(admission).toEqual({ admitted: true });
        expect(await rowsFor(first.pool, 'usda')).toBe(6);
    });

    it('refuses a worker call at its share, and answers when its own oldest call ages out', async () => {
        // The window's oldest call is a live one, 1,000 s old, so an answer read from every lane's calls would be
        // 2,600 s away. The worker's own oldest, 300 s old, frees its share 3,300 s from now.
        await insertAged(first.pool, 'usda', [1000], 'interactive');
        await insertAged(first.pool, 'usda', [100, 200, 300]);

        const admission = await second.calls.admit({
            source: 'usda',
            lane: 'worker',
            ceiling: 9,
            laneCeiling: 3,
            windowSeconds: 3600,
        });
        const now = await databaseNow(first.pool);

        expect(!admission.admitted && admission.reason).toBe('ceiling');
        expect(!admission.admitted && Date.parse(admission.retryAt) - now).toBeGreaterThan(3_298_000);
        expect(!admission.admitted && Date.parse(admission.retryAt) - now).toBeLessThan(3_302_000);
        expect(await rowsFor(first.pool, 'usda')).toBe(4);
    });

    it('answers the later of the two moments when both counts are at their ceilings', async () => {
        // Ceiling 4, the worker's own 2. Every lane's calls free a place when the 3,100 s-old live call ages out,
        // 500 s from now; the worker's own free one when its 200 s-old call does, 3,400 s from now. A live call on
        // the same window waits only for the first.
        await insertAged(first.pool, 'usda', [3000, 3100], 'interactive');
        await insertAged(first.pool, 'usda', [100, 200]);

        const worker = await second.calls.admit({
            source: 'usda',
            lane: 'worker',
            ceiling: 4,
            laneCeiling: 2,
            windowSeconds: 3600,
        });
        const live = await second.calls.admit({
            source: 'usda',
            lane: 'interactive',
            ceiling: 4,
            laneCeiling: 4,
            windowSeconds: 3600,
        });
        const now = await databaseNow(first.pool);

        expect(!worker.admitted && Date.parse(worker.retryAt) - now).toBeGreaterThan(3_398_000);
        expect(!worker.admitted && Date.parse(worker.retryAt) - now).toBeLessThan(3_402_000);
        expect(!live.admitted && Date.parse(live.retryAt) - now).toBeGreaterThan(498_000);
        expect(!live.admitted && Date.parse(live.retryAt) - now).toBeLessThan(502_000);
        expect(await rowsFor(first.pool, 'usda')).toBe(4);
    });

    it('answers a full window with the moment its oldest counted call ages out, by the database clock', async () => {
        // Three calls at 100 s, 200 s and 300 s old fill a ceiling of 3 in a 3,600 s window. The next admission is
        // possible once the 300 s-old call ages out, 3,300 s from now.
        await insertAged(first.pool, 'usda', [100, 200, 300]);

        const admission = await second.calls.admit({
            source: 'usda',
            lane: 'worker',
            ceiling: 3,
            laneCeiling: 3,
            windowSeconds: 3600,
        });
        const now = await databaseNow(first.pool);

        expect(admission.admitted).toBe(false);
        expect(!admission.admitted && admission.reason).toBe('ceiling');
        expect(!admission.admitted && Date.parse(admission.retryAt) - now).toBeGreaterThan(3_298_000);
        expect(!admission.admitted && Date.parse(admission.retryAt) - now).toBeLessThan(3_302_000);
        expect(await rowsFor(first.pool, 'usda')).toBe(3);
    });

    it('answers from the right row when an override leaves more calls in the window than its ceiling', async () => {
        // Five calls, ceiling 3: admission needs three to age out, so the third-oldest (300 s) decides.
        await insertAged(first.pool, 'usda', [100, 200, 300, 400, 500]);

        const admission = await first.calls.admit({
            source: 'usda',
            lane: 'worker',
            ceiling: 3,
            laneCeiling: 3,
            windowSeconds: 3600,
        });
        const now = await databaseNow(first.pool);

        expect(!admission.admitted && Date.parse(admission.retryAt) - now).toBeGreaterThan(3_298_000);
        expect(!admission.admitted && Date.parse(admission.retryAt) - now).toBeLessThan(3_302_000);
    });

    it('answers a ceiling of 0 with the database clock, since no call ageing out frees one', async () => {
        await insertAged(first.pool, 'usda', [100]);

        const before = await databaseNow(second.pool);
        const admission = await first.calls.admit({
            source: 'usda',
            lane: 'worker',
            ceiling: 0,
            laneCeiling: 0,
            windowSeconds: 3600,
        });
        const after = await databaseNow(second.pool);

        expect(!admission.admitted && admission.reason).toBe('ceiling');
        const retryAt = admission.admitted ? Number.NaN : Date.parse(admission.retryAt);
        expect(retryAt).toBeGreaterThanOrEqual(before);
        expect(retryAt).toBeLessThanOrEqual(after);
    });

    it('refuses every task while a block one task wrote is live, without counting the call', async () => {
        await first.blocks.record({ source: 'usda', reason: 'rateLimited', seconds: 600 });

        const admission = await second.calls.admit({
            source: 'usda',
            lane: 'interactive',
            ceiling: 9,
            laneCeiling: 9,
            windowSeconds: 3600,
        });
        const now = await databaseNow(second.pool);

        expect(!admission.admitted && admission.reason).toBe('blocked');
        expect(!admission.admitted && Date.parse(admission.retryAt) - now).toBeGreaterThan(598_000);
        expect(!admission.admitted && Date.parse(admission.retryAt) - now).toBeLessThan(602_000);
        expect(await rowsFor(first.pool, 'usda')).toBe(0);
    });

    it('admits again once the block has ended, and a block on one source leaves another admitted', async () => {
        await first.pool.query(
            `INSERT INTO source_backoff (source, blocked_until, reason, observed_at)
             VALUES ('usda', now() - interval '1 second', 'unavailable', now() - interval '61 seconds')`,
        );
        // Another source's live block. USDA is the only callable source, so it is written as the ledger stores it.
        await first.pool.query(
            `INSERT INTO source_backoff (source, blocked_until, reason, observed_at)
             VALUES ('ciqual', now() + interval '60 seconds', 'unavailable', now())`,
        );

        await expect(
            second.calls.admit({ source: 'usda', lane: 'worker', ceiling: 9, laneCeiling: 9, windowSeconds: 3600 }),
        ).resolves.toEqual({ admitted: true });
    });

    it('keeps the later end when a shorter block arrives, and takes a longer one', async () => {
        await first.blocks.record({ source: 'usda', reason: 'rateLimited', seconds: 3600 });
        await second.blocks.record({ source: 'usda', reason: 'unavailable', seconds: 60 });

        const kept = await first.pool.query<{ reason: string; left: number }>(
            `SELECT reason, extract(epoch FROM blocked_until - now())::float8 AS left FROM source_backoff`,
        );

        expect(kept.rows).toHaveLength(1);
        expect(kept.rows[0]?.reason).toBe('rateLimited');
        expect(kept.rows[0]?.left).toBeGreaterThan(3590);

        await second.blocks.record({ source: 'usda', reason: 'quotaExhausted', seconds: 7200 });

        const longer = await first.pool.query<{ reason: string; left: number }>(
            `SELECT reason, extract(epoch FROM blocked_until - now())::float8 AS left FROM source_backoff`,
        );

        expect(longer.rows[0]?.reason).toBe('quotaExhausted');
        expect(longer.rows[0]?.left).toBeGreaterThan(7190);
    });

    it('keeps the latest end when many tasks write blocks at once', async () => {
        // Thirty writers over two pools race the same row, the first insert included. The longest block is one writer,
        // placed at a different position each round; it must win every round, with its own reason.
        const writers = 30;

        for (let round = 0; round < 5; round += 1) {
            await first.pool.query('DELETE FROM source_backoff');
            const longest = (round * 7) % writers;

            await Promise.all(
                Array.from({ length: writers }, async (_, index) =>
                    (index % 2 === 0 ? first : second).blocks.record({
                        source: 'usda',
                        reason: index === longest ? 'quotaExhausted' : 'unavailable',
                        seconds: index === longest ? 7200 : 60 + index,
                    }),
                ),
            );

            const kept = await first.pool.query<{ reason: string; left: number }>(
                `SELECT reason, extract(epoch FROM blocked_until - now())::float8 AS left FROM source_backoff`,
            );

            expect(kept.rows).toHaveLength(1);
            expect(kept.rows[0]?.reason).toBe('quotaExhausted');
            expect(kept.rows[0]?.left).toBeGreaterThan(7190);
        }
    });

    it('answers contended when the limiter lock is not granted in time, and records nothing', async () => {
        const admission = await whileLimiterLocked('usda', async () => {
            const startedAt = Date.now();
            const result = await first.calls.admit({
                source: 'usda',
                lane: 'worker',
                ceiling: 9,
                laneCeiling: 9,
                windowSeconds: 3600,
            });
            const waited = Date.now() - startedAt;

            // The floor proves it waited for the lock. No ceiling: `contended` is SQLSTATE 55P03, so the lock
            // timeout ended the wait and nothing else did, and a wall-clock ceiling only measured how busy the machine
            // was (it failed at 4.5 s against a 2 s timeout on a loaded host, 2026-10-01).
            expect(waited).toBeGreaterThanOrEqual(ADMISSION_LOCK_TIMEOUT_MS - 100);

            return result;
        });

        expect(!admission.admitted && admission.reason).toBe('contended');
        expect(await rowsFor(first.pool, 'usda')).toBe(0);
    });

    it('dates a contended retry from the end of the lock wait, so it is still ahead when the refusal arrives', async () => {
        // Read on the database clock around the refusal. The retry is measured after the whole lock wait, so it can be
        // no earlier than `before + wait + retry`, and no later than `after + retry`; a retry dated from before the
        // wait lands a whole lock wait in the past and a waiting caller retries at once into the same lock.
        const before = await databaseNow(second.pool);
        const admission = await whileLimiterLocked('usda', async () =>
            first.calls.admit({ source: 'usda', lane: 'worker', ceiling: 9, laneCeiling: 9, windowSeconds: 3600 }),
        );
        const after = await databaseNow(second.pool);

        expect(!admission.admitted && admission.reason).toBe('contended');
        const retryAt = admission.admitted ? Number.NaN : Date.parse(admission.retryAt);
        expect(retryAt).toBeGreaterThan(after);
        expect(retryAt).toBeGreaterThanOrEqual(before + ADMISSION_LOCK_TIMEOUT_MS + CONTENDED_RETRY_MS - 10);
        expect(retryAt).toBeLessThanOrEqual(after + CONTENDED_RETRY_MS);
    });

    it('stamps an admitted call with the clock after the lock wait, never the transaction start', async () => {
        // A call stamped before its lock wait leaves the window early by the length of the wait, so a short window
        // would admit past its ceiling. The holder reads the database clock, then releases; the stamp must not be
        // earlier than that reading.
        const holder = new pg.Client({ connectionString: foodDb().appUrl });
        await holder.connect();

        try {
            await holder.query('SELECT pg_advisory_lock($1, hashtext($2))', [
                ADVISORY_LOCK_CLASSES.foodSourceLimiter,
                'usda',
            ]);
            const settled = first.calls
                .admit({ source: 'usda', lane: 'worker', ceiling: 9, laneCeiling: 9, windowSeconds: 3600 })
                .then(
                    (admission) => ({ admission }),
                    (error: unknown) => ({ error }),
                );

            // Wait until admission is queued on the lock, then hold it 300 ms more: well inside the 2 s lock wait even
            // on a loaded host, and long enough that a stamp taken before the wait would read ~300 ms early.
            let waiting = 0;

            for (let poll = 0; poll < 50 && waiting === 0; poll += 1) {
                await sleep(10);
                const queued = await holder.query<{ n: number }>(
                    `SELECT count(*)::int AS n FROM pg_locks
                      WHERE locktype = 'advisory' AND NOT granted AND objsubid = 2
                        AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
                        AND classid = $1::int::oid AND objid = hashtext($2)::oid`,
                    [ADVISORY_LOCK_CLASSES.foodSourceLimiter, 'usda'],
                );
                waiting = queued.rows[0]?.n ?? 0;
            }

            expect(waiting).toBe(1);
            await sleep(300);

            const released = await holder.query<{ at: string }>('SELECT clock_timestamp()::text AS at');
            await holder.query('SELECT pg_advisory_unlock($1, hashtext($2))', [
                ADVISORY_LOCK_CLASSES.foodSourceLimiter,
                'usda',
            ]);

            await expect(settled).resolves.toEqual({ admission: { admitted: true } });
            const stamped = await first.pool.query<{ lag_ms: number }>(
                `SELECT (extract(epoch FROM called_at - $1::timestamptz) * 1000)::float8 AS lag_ms
                   FROM source_call_log WHERE source = 'usda'::food_source`,
                [released.rows[0]?.at],
            );

            expect(stamped.rows).toHaveLength(1);
            expect(stamped.rows[0]?.lag_ms).toBeGreaterThanOrEqual(0);
        } finally {
            await holder.end();
        }
    });

    it('never passes the ceiling under a REPEATABLE READ session default: admission pins READ COMMITTED', async () => {
        // A REPEATABLE READ snapshot is taken before the lock, so each admission counts a stale window and admits.
        const repeatableRead = { options: '-c default_transaction_isolation=repeatable\\ read' };
        const left = openTask(repeatableRead);
        const right = openTask(repeatableRead);

        try {
            const isolation = await left.pool.query<{ level: string }>(
                `SELECT current_setting('default_transaction_isolation') AS level`,
            );
            expect(isolation.rows[0]?.level).toBe('repeatable read');

            const ceiling = 9;
            const admissions = await Promise.all(
                Array.from({ length: 40 }, async (_, index) =>
                    (index % 2 === 0 ? left : right).calls.admit({
                        source: 'usda',
                        lane: 'worker',
                        ceiling,
                        laneCeiling: ceiling,
                        windowSeconds: 3600,
                    }),
                ),
            );

            expect(admissions.filter((admission) => admission.admitted)).toHaveLength(ceiling);
            expect(await rowsFor(first.pool, 'usda')).toBe(ceiling);
        } finally {
            await left.pool.end();
            await right.pool.end();
        }
    });

    it('cancels a statement after the lock at statement_timeout, before the lock wait could end it', async () => {
        // An exclusive lock on the block ledger stalls admission's block read. Under statement_timeout the read is
        // cancelled (57014) well inside the lock wait; without it, lock_timeout would end it (55P03) only after the
        // full wait.
        const holder = new pg.Client({ connectionString: foodDb().appUrl });
        await holder.connect();

        try {
            await holder.query('BEGIN');
            await holder.query('LOCK TABLE source_backoff IN ACCESS EXCLUSIVE MODE');

            const startedAt = Date.now();
            const failure = await first.calls
                .admit({ source: 'usda', lane: 'worker', ceiling: 9, laneCeiling: 9, windowSeconds: 3600 })
                .then(
                    () => undefined,
                    (error: unknown) => error,
                );
            const waited = Date.now() - startedAt;

            expect(sqlStateOf(failure)).toBe('57014');
            expect(waited).toBeLessThan(ADMISSION_LOCK_TIMEOUT_MS);
        } finally {
            await holder.query('ROLLBACK');
            await holder.end();
        }

        expect(await rowsFor(first.pool, 'usda')).toBe(0);
    });

    it('leaves the pooled connection as it found it, after an admission and after a contended refusal', async () => {
        const single = openTask({ max: 1 });

        try {
            const found = await sessionSettings(single.pool);

            await expect(
                single.calls.admit({ source: 'usda', lane: 'worker', ceiling: 9, laneCeiling: 9, windowSeconds: 3600 }),
            ).resolves.toEqual({ admitted: true });
            expect(await sessionSettings(single.pool)).toEqual(found);

            const contended = await whileLimiterLocked('usda', async () =>
                single.calls.admit({ source: 'usda', lane: 'worker', ceiling: 9, laneCeiling: 9, windowSeconds: 3600 }),
            );
            expect(!contended.admitted && contended.reason).toBe('contended');
            expect(await sessionSettings(single.pool)).toEqual(found);
        } finally {
            await single.pool.end();
        }
    });

    it('runs no more statements under statement_timeout than the time bound counts, on the longest path', async () => {
        // The ceiling refusal is the longest path: block read, insert, age-out read, then COMMIT.
        const statements: string[] = [];
        const logged = openTask({
            logger: {
                logQuery(query: string): void {
                    statements.push(query);
                },
            },
        });

        try {
            await insertAged(first.pool, 'usda', [100, 200, 300]);
            const admission = await logged.calls.admit({
                source: 'usda',
                lane: 'worker',
                ceiling: 3,
                laneCeiling: 3,
                windowSeconds: 3600,
            });
            expect(!admission.admitted && admission.reason).toBe('ceiling');

            const lockAt = statements.findIndex((statement) => statement.includes('pg_advisory_xact_lock'));
            const timeoutAt = statements.findIndex((statement) => statement.includes("'statement_timeout'"));

            expect(lockAt).toBeGreaterThanOrEqual(0);
            expect(timeoutAt).toBeGreaterThan(lockAt);
            expect(statements.slice(timeoutAt + 1)).toHaveLength(ADMISSION_TIMED_STATEMENTS);
            expect(statements.at(-1)).toBe('commit');
        } finally {
            await logged.pool.end();
        }
    });

    it('fails a block write that meets a held row lock at lock_timeout, keeping the block already written', async () => {
        await first.blocks.record({ source: 'usda', reason: 'unavailable', seconds: 60 });

        const holder = new pg.Client({ connectionString: foodDb().appUrl });
        await holder.connect();

        try {
            await holder.query('BEGIN');
            await holder.query(`SELECT 1 FROM source_backoff WHERE source = 'usda'::food_source FOR UPDATE`);

            const startedAt = Date.now();
            // Raced against a timer: an unbounded write waits for the holder forever, and that is the failure.
            const outcome = await Promise.race([
                first.blocks.record({ source: 'usda', reason: 'rateLimited', seconds: 3600 }).then(
                    () => 'written' as const,
                    (error: unknown) => error,
                ),
                sleep(FOOD_POOL_CONNECT_TIMEOUT_MS + RECORD_TIMED_STATEMENTS * RECORD_STATEMENT_TIMEOUT_MS).then(
                    () => 'still waiting' as const,
                ),
            ]);
            const waited = Date.now() - startedAt;

            // SQLSTATE 55P03 is the lock timeout and nothing else (a statement timeout is 57014), so it alone proves
            // which bound ended the write; the floor proves the write waited. A wall-clock ceiling only measured the
            // host (it failed at 3.6 s on a loaded machine, 2026-10-01).
            expect(sqlStateOf(outcome)).toBe('55P03');
            expect(waited).toBeGreaterThanOrEqual(RECORD_LOCK_TIMEOUT_MS - 50);
        } finally {
            await holder.query('ROLLBACK');
            await holder.end();
        }

        const kept = await first.pool.query<{ reason: string }>('SELECT reason FROM source_backoff');
        expect(kept.rows).toEqual([{ reason: 'unavailable' }]);
    });

    it('runs the block write in one transaction whose statements after the bound are the ones the bound counts', async () => {
        const statements: string[] = [];
        const logged = openTask({
            max: 1,
            logger: {
                logQuery(query: string): void {
                    statements.push(query);
                },
            },
        });

        try {
            const found = await sessionSettings(logged.pool);

            await logged.blocks.record({ source: 'usda', reason: 'rateLimited', seconds: 3600 });

            const lockAt = statements.findIndex((statement) => statement.includes("'lock_timeout'"));
            const timeoutAt = statements.findIndex((statement) => statement.includes("'statement_timeout'"));

            expect(statements[0]).toBe('begin');
            expect(lockAt).toBeGreaterThan(0);
            expect(timeoutAt).toBeGreaterThan(lockAt);
            expect(statements.slice(timeoutAt + 1)).toHaveLength(RECORD_TIMED_STATEMENTS);
            expect(statements.at(-1)).toBe('commit');
            // `set_config(…, true)` ends with the transaction: the pooled connection keeps no timeout.
            expect(await sessionSettings(logged.pool)).toEqual(found);
        } finally {
            await logged.pool.end();
        }
    });

    // On the live lane, whose ceiling is the plain 90% rule: this case is about the window, not the worker's share.
    it('counts USDA over its own declared hour: older calls age out, calls inside it count', async () => {
        await insertAged(first.pool, 'usda', [7200, 7200]);
        const limiter = new RollingWindowLimiter(first.calls, { usda: { requests: 3, windowSeconds: 3600 } });

        // A ceiling of ⌊0.9 × 3⌋ = 2: the two calls two hours old have aged out.
        await expect(limiter.admit('usda', 'interactive')).resolves.toEqual({ admitted: true });

        // The call just admitted and one half an hour old fill the ceiling.
        await insertAged(first.pool, 'usda', [1800]);
        await expect(limiter.admit('usda', 'interactive')).resolves.toMatchObject({
            admitted: false,
            reason: 'ceiling',
        });
    });

    // The admin metrics read the worker's pause (`windowStatus`) from the rule admission inserts under, so the two
    // can never disagree: a window reads paused exactly when admitting on it would refuse.
    it.each([
        { name: 'under both ceilings', worker: 1, live: 1, blocked: false, paused: false },
        { name: 'the worker at its share', worker: 2, live: 0, blocked: false, paused: true },
        {
            name: 'every lane at the ceiling, the worker under its share',
            worker: 1,
            live: 2,
            blocked: false,
            paused: true,
        },
        {
            name: 'live calls at the share, the window under the ceiling',
            worker: 0,
            live: 2,
            blocked: false,
            paused: false,
        },
        { name: 'a live block under both ceilings', worker: 0, live: 0, blocked: true, paused: true },
    ])('reads a window paused exactly when its admission refuses: $name', async ({ worker, live, blocked, paused }) => {
        const input = { source: 'usda', lane: 'worker', ceiling: 3, laneCeiling: 2, windowSeconds: 3600 } as const;

        await insertAged(
            first.pool,
            'usda',
            Array.from({ length: worker }, () => 100),
        );
        await insertAged(
            first.pool,
            'usda',
            Array.from({ length: live }, () => 100),
            'interactive',
        );

        if (blocked) {
            await first.blocks.record({ source: 'usda', reason: 'unavailable', seconds: 60 });
        }

        const status = await first.calls.windowStatus(input);
        const admission = await first.calls.admit(input);

        expect(status).toStrictEqual({ byLane: { interactive: live, worker }, paused });
        expect(admission.admitted).toBe(!paused);
    });

    // USDA is the one callable source (owner, 2026-10-01), so the longest declared window is its hour.
    it('prunes rows older than the longest declared window and keeps every row inside it', async () => {
        expect(PRUNE_HORIZON_SECONDS).toBe(3600);
        await insertAged(first.pool, 'usda', [10, 3_500, 3_700, 86_000]);

        const pruned = await new RollingWindowLimiter(first.calls, {}).pruneAged();

        expect(pruned).toBe(2);
        expect(await rowsFor(first.pool, 'usda')).toBe(2);
    });

    it('documents what admission reads from the lane column, and names where the worker’s share is set', async () => {
        // Every lane's calls count toward the ceiling, and the worker's own calls also count toward its share, which
        // is one constant (owner, 2026-10-02) that the comment names rather than restating.
        const { rows } = await first.pool.query<{ comment: string | null }>(
            `SELECT col_description('source_call_log'::regclass, attnum) AS comment
               FROM pg_attribute WHERE attrelid = 'source_call_log'::regclass AND attname = 'channel'`,
        );

        expect(rows[0]?.comment).toMatch(/every lane's calls together/iu);
        expect(rows[0]?.comment).toMatch(/worker's own calls/iu);
        expect(rows[0]?.comment).not.toMatch(/attribution only/iu);
        expect(rows[0]?.comment).toMatch(/WORKER_WINDOW_SHARE/u);
        expect(rows[0]?.comment).not.toMatch(/how far/u);
        // Nothing mirrors a source at run time (owner, 2026-10-01), so no lane names a mirror sync.
        expect(rows[0]?.comment).not.toMatch(/mirror/iu);
    });
});
