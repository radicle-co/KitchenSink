/**
 * LOCAL e2e (CODING_STANDARDS §7.1a): admission and the shared block on a real Postgres, the guarantees only a
 * real database can show (ADR-0053 §2, §5, plan U27):
 *
 * - two pools, standing in for two tasks, admitting at once never pass the ceiling together;
 * - a block one pool writes refuses the other pool's admission;
 * - a lock not granted within `lock_timeout` answers `contended`, with a retry instant after the wait, and records
 *   nothing;
 * - an admitted call is stamped with the database clock after the lock wait, not the transaction's start;
 * - admission pins READ COMMITTED, so a session defaulting to REPEATABLE READ still never passes the ceiling;
 * - every statement after the lock runs under `statement_timeout`, and neither timeout leaks into the pool;
 * - concurrent block writes keep the latest end;
 * - a block write that meets a held row lock fails at `lock_timeout` rather than waiting, and its statements run under
 *   `statement_timeout`, so a stalled ledger cannot hold a source call past the bound `sourceCallLog.dao.ts` states;
 * - each source's window comes from the register: USDA counts per hour, Matvaretabellen per day;
 * - `pruneAged` keeps every row inside the longest declared window and deletes the rest.
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
import { foodE2eDb, hasTestDatabase } from '../support/roleDb.js';

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
        connectionString: foodE2eDb().appUrl,
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
    const holder = new pg.Client({ connectionString: foodE2eDb().appUrl });
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
 * @sideEffect Writes `source_call_log`.
 */
async function insertAged(pool: pg.Pool, source: string, secondsAgo: readonly number[]): Promise<void> {
    for (const age of secondsAgo) {
        await pool.query(
            `INSERT INTO source_call_log (source, channel, called_at)
             VALUES ($1::food_source, 'worker', now() - make_interval(secs => $2::int))`,
            [source, age],
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

describe.skipIf(!hasTestDatabase)('source admission and the shared block (real Postgres)', () => {
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
        await foodE2eDb().truncate();
    });

    it('never admits past the ceiling when two tasks admit at once', async () => {
        const ceiling = 9;
        const attempts = Array.from({ length: 40 }, async (_, index) =>
            (index % 2 === 0 ? first : second).calls.admit({
                source: 'usda',
                lane: index % 3 === 0 ? 'interactive' : 'worker',
                ceiling,
                windowSeconds: 3600,
            }),
        );

        const admissions = await Promise.all(attempts);

        expect(admissions.filter((admission) => admission.admitted)).toHaveLength(ceiling);
        expect(await rowsFor(first.pool, 'usda')).toBe(ceiling);
        expect(admissions.every((admission) => admission.admitted || admission.reason === 'ceiling')).toBe(true);
    });

    it('answers a full window with the moment its oldest counted call ages out, by the database clock', async () => {
        // Three calls at 100 s, 200 s and 300 s old fill a ceiling of 3 in a 3,600 s window. The next admission is
        // possible once the 300 s-old call ages out, 3,300 s from now.
        await insertAged(first.pool, 'usda', [100, 200, 300]);

        const admission = await second.calls.admit({ source: 'usda', lane: 'worker', ceiling: 3, windowSeconds: 3600 });
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

        const admission = await first.calls.admit({ source: 'usda', lane: 'worker', ceiling: 3, windowSeconds: 3600 });
        const now = await databaseNow(first.pool);

        expect(!admission.admitted && Date.parse(admission.retryAt) - now).toBeGreaterThan(3_298_000);
        expect(!admission.admitted && Date.parse(admission.retryAt) - now).toBeLessThan(3_302_000);
    });

    it('answers a ceiling of 0 with the database clock, since no call ageing out frees one', async () => {
        await insertAged(first.pool, 'usda', [100]);

        const before = await databaseNow(second.pool);
        const admission = await first.calls.admit({ source: 'usda', lane: 'worker', ceiling: 0, windowSeconds: 3600 });
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
        await first.blocks.record({ source: 'matvaretabellen', reason: 'unavailable', seconds: 60 });

        await expect(
            second.calls.admit({ source: 'usda', lane: 'worker', ceiling: 9, windowSeconds: 3600 }),
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
            const result = await first.calls.admit({ source: 'usda', lane: 'worker', ceiling: 9, windowSeconds: 3600 });
            const waited = Date.now() - startedAt;

            expect(waited).toBeGreaterThanOrEqual(ADMISSION_LOCK_TIMEOUT_MS - 100);
            expect(waited).toBeLessThan(ADMISSION_LOCK_TIMEOUT_MS * 2);

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
            first.calls.admit({ source: 'usda', lane: 'worker', ceiling: 9, windowSeconds: 3600 }),
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
        const holder = new pg.Client({ connectionString: foodE2eDb().appUrl });
        await holder.connect();

        try {
            await holder.query('SELECT pg_advisory_lock($1, hashtext($2))', [
                ADVISORY_LOCK_CLASSES.foodSourceLimiter,
                'usda',
            ]);
            const settled = first.calls.admit({ source: 'usda', lane: 'worker', ceiling: 9, windowSeconds: 3600 }).then(
                (admission) => ({ admission }),
                (error: unknown) => ({ error }),
            );

            // Wait until admission is queued on the lock, then hold it ~1 s more: well inside the 2 s lock wait.
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
            await sleep(1_000);

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
        const holder = new pg.Client({ connectionString: foodE2eDb().appUrl });
        await holder.connect();

        try {
            await holder.query('BEGIN');
            await holder.query('LOCK TABLE source_backoff IN ACCESS EXCLUSIVE MODE');

            const startedAt = Date.now();
            const failure = await first.calls
                .admit({ source: 'usda', lane: 'worker', ceiling: 9, windowSeconds: 3600 })
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
                single.calls.admit({ source: 'usda', lane: 'worker', ceiling: 9, windowSeconds: 3600 }),
            ).resolves.toEqual({ admitted: true });
            expect(await sessionSettings(single.pool)).toEqual(found);

            const contended = await whileLimiterLocked('usda', async () =>
                single.calls.admit({ source: 'usda', lane: 'worker', ceiling: 9, windowSeconds: 3600 }),
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

        const holder = new pg.Client({ connectionString: foodE2eDb().appUrl });
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

            expect(sqlStateOf(outcome)).toBe('55P03');
            expect(waited).toBeGreaterThanOrEqual(RECORD_LOCK_TIMEOUT_MS - 50);
            expect(waited).toBeLessThan(RECORD_STATEMENT_TIMEOUT_MS);
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

    it('counts each source over its own declared window: Matvaretabellen a day, USDA an hour', async () => {
        // Two calls each, two hours old: outside USDA's hour, inside Matvaretabellen's day.
        await insertAged(first.pool, 'usda', [7200, 7200]);
        await insertAged(first.pool, 'matvaretabellen', [7200, 7200]);
        const limiter = new RollingWindowLimiter(first.calls, {
            usda: { requests: 3, windowSeconds: 3600 },
            matvaretabellen: { requests: 3, windowSeconds: 86_400 },
        });

        // A ceiling of ⌊0.9 × 3⌋ = 2: USDA's old calls have aged out, Matvaretabellen's have not.
        await expect(limiter.admit('usda', 'worker')).resolves.toEqual({ admitted: true });
        await expect(limiter.admit('matvaretabellen', 'worker')).resolves.toMatchObject({
            admitted: false,
            reason: 'ceiling',
        });
    });

    it('prunes rows older than the longest declared window and keeps every row inside it', async () => {
        expect(PRUNE_HORIZON_SECONDS).toBe(86_400);
        await insertAged(first.pool, 'usda', [10, 3_700, 86_000]);
        await insertAged(first.pool, 'matvaretabellen', [86_000, 86_500, 90_000]);

        const pruned = await new RollingWindowLimiter(first.calls, {}).pruneAged();

        expect(pruned).toBe(2);
        expect(await rowsFor(first.pool, 'usda')).toBe(3);
        expect(await rowsFor(first.pool, 'matvaretabellen')).toBe(1);
    });

    it('documents the lane column as attribution only, since both lanes share one 90% ceiling', async () => {
        // 0010 described the lane as deciding how far into the quota a caller may push; ADR-0053 §2 replaced that
        // with one ceiling for every caller, and 0019 restates the column comment.
        const { rows } = await first.pool.query<{ comment: string | null }>(
            `SELECT col_description('source_call_log'::regclass, attnum) AS comment
               FROM pg_attribute WHERE attrelid = 'source_call_log'::regclass AND attname = 'channel'`,
        );

        expect(rows[0]?.comment).toMatch(/attribution only/iu);
        expect(rows[0]?.comment).not.toMatch(/how far/u);
    });
});
