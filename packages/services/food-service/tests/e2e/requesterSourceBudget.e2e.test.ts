/**
 * LOCAL e2e (CODING_STANDARDS §7.1a): the per-requester source budget's store on a real Postgres, the guarantees only
 * a real database can show (plan 002, the hourly cap owed before S6):
 *
 * - migration 0020 built the table the store writes, with its key and its `CHECK`;
 * - two pools, standing in for two tasks, charging at once never admit past the limit together;
 * - a charge is weighted, admitted whole or refused whole, and a refused charge is not counted;
 * - the window is fixed at a requester's first charge, and a charge after it ends opens a new one;
 * - the wait a refusal names comes from the database clock;
 * - a held row lock fails the charge within the statement bound instead of hanging the request, and the bound does
 *   not leak into the pool;
 * - a refund gives back only calls charged in the window it was charged in, never recreates a row the erasure sweep
 *   removed, and loses no charge made at the same time.
 *
 * Every connection is `food_app`, the role a deployed task holds.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import * as schema from '../../src/db/schema/index.js';
import {
    BUDGET_STATEMENT_TIMEOUT_MS,
    RequesterSourceBudgetDao,
    type BudgetChargeInput,
    type BudgetReceipt,
} from '../../src/foods/dao/requesterSourceBudget.dao.js';
import { foodDb } from '../support/roleDb.js';

const COOK = '01J9ZK8N7QF3B2X4M6T0V5C1AB';
const OTHER_COOK = '01J9ZK8N7QF3B2X4M6T0V5C1AC';
const HOUR = 3_600;

/** One task's connection: its own pool and its own store over it. */
interface Task {
    readonly pool: pg.Pool;
    readonly budget: RequesterSourceBudgetDao;
}

/**
 * Open one task's pool as `food_app`.
 *
 * Four connections by default: every charge in these cases waits on ONE requester's row lock within the 500 ms bound,
 * so a deeper queue of open transactions times out on a loaded machine, while a request waiting for a connection
 * waits outside the bound. Two pools of four still interleave eight transactions on the row.
 *
 * @param max - The pool's size.
 * @returns The task.
 * @sideEffect Opens a pool.
 */
function openTask(max = 4): Task {
    const pool = new pg.Pool({ connectionString: foodDb().appUrl, max });

    return { pool, budget: new RequesterSourceBudgetDao(drizzle(pool, { schema })) };
}

/** A charge for {@link COOK} over an hour. */
function charge(cost: number, limit: number, requesterId = COOK): BudgetChargeInput {
    return { requesterId, cost, limit, windowSeconds: HOUR };
}

/**
 * Charge and return the receipt, failing the test when the charge is refused.
 *
 * @param task - The task that charges.
 * @param input - The charge.
 * @returns The receipt.
 * @sideEffect Charges `requester_source_budget`.
 */
async function admitted(task: Task, input: BudgetChargeInput): Promise<BudgetReceipt> {
    const verdict = await task.budget.charge(input);

    if (!verdict.admitted) {
        return expect.unreachable(`the charge of ${input.cost} was refused`);
    }

    return verdict.receipt;
}

/**
 * A requester's row, with its window end as seconds from the database's now.
 *
 * @param pool - A pool.
 * @param requesterId - The requester.
 * @returns The spend and the seconds left, or `undefined` when there is no row.
 * @sideEffect Reads `requester_source_budget`.
 */
async function rowFor(pool: pg.Pool, requesterId: string): Promise<{ spent: number; secondsLeft: number } | undefined> {
    const result = await pool.query<{ spent: number; seconds_left: number }>(
        `SELECT spent, extract(epoch FROM window_ends_at - now())::float8 AS seconds_left
           FROM requester_source_budget WHERE requester_id = $1`,
        [requesterId],
    );
    const row = result.rows[0];

    return row === undefined ? undefined : { spent: row.spent, secondsLeft: row.seconds_left };
}

/**
 * Move a requester's window end to `seconds` from the database's now (negative ends it).
 *
 * @param pool - A pool.
 * @param requesterId - The requester.
 * @param seconds - Where the window should end, relative to now.
 * @sideEffect Writes `requester_source_budget`.
 */
async function moveWindowEnd(pool: pg.Pool, requesterId: string, seconds: number): Promise<void> {
    await pool.query(
        `UPDATE requester_source_budget SET window_ends_at = now() + make_interval(secs => $2::int)
          WHERE requester_id = $1`,
        [requesterId, seconds],
    );
}

/**
 * The session's `statement_timeout`, as one pooled connection reports it.
 *
 * @param pool - A pool of one connection.
 * @returns The setting.
 * @sideEffect Reads a session setting.
 */
async function statementTimeoutOf(pool: pg.Pool): Promise<string | undefined> {
    const result = await pool.query<{ setting: string }>(`SELECT current_setting('statement_timeout') AS setting`);

    return result.rows[0]?.setting;
}

describe('the per-requester source budget store (real Postgres)', () => {
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

    describe('the table migration 0020 built', () => {
        it('keys one row per requester, with the spend and the window end required', async () => {
            const columns = await first.pool.query<{ column_name: string; data_type: string; is_nullable: string }>(
                `SELECT column_name, data_type, is_nullable FROM information_schema.columns
                  WHERE table_name = 'requester_source_budget' ORDER BY column_name`,
            );

            expect(columns.rows).toEqual([
                { column_name: 'requester_id', data_type: 'text', is_nullable: 'NO' },
                { column_name: 'spent', data_type: 'integer', is_nullable: 'NO' },
                { column_name: 'window_ends_at', data_type: 'timestamp with time zone', is_nullable: 'NO' },
            ]);

            await first.pool.query(
                `INSERT INTO requester_source_budget (requester_id, spent, window_ends_at) VALUES ($1, 1, now())`,
                [COOK],
            );

            await expect(
                first.pool.query(
                    `INSERT INTO requester_source_budget (requester_id, spent, window_ends_at) VALUES ($1, 1, now())`,
                    [COOK],
                ),
            ).rejects.toMatchObject({ code: '23505' });
        });

        // A refund can bring a window back to nothing spent; below nothing is a refund of a call never charged.
        it('keeps a row that spends nothing, and refuses one that spends less', async () => {
            await first.pool.query(
                `INSERT INTO requester_source_budget (requester_id, spent, window_ends_at) VALUES ($1, 0, now())`,
                [COOK],
            );

            await expect(
                first.pool.query(
                    `INSERT INTO requester_source_budget (requester_id, spent, window_ends_at) VALUES ($1, -1, now())`,
                    [OTHER_COOK],
                ),
            ).rejects.toMatchObject({ code: '23514' });
        });
    });

    it('never admits past the limit when two tasks charge at once', async () => {
        const limit = 9;
        const verdicts = await Promise.all(
            Array.from({ length: 40 }, async (_, index) =>
                (index % 2 === 0 ? first : second).budget.charge(charge(1, limit)),
            ),
        );

        expect(verdicts.filter((verdict) => verdict.admitted)).toHaveLength(limit);
        expect((await rowFor(first.pool, COOK))?.spent).toBe(limit);
    });

    it('admits a charge whole or refuses it whole, and never counts a refusal', async () => {
        const verdicts = [
            await first.budget.charge(charge(20, 120)),
            await second.budget.charge(charge(90, 120)),
            // 110 spent: 20 more would make 130.
            await first.budget.charge(charge(20, 120)),
            // The refusal left 110, so 10 more is exactly the limit.
            await second.budget.charge(charge(10, 120)),
            await first.budget.charge(charge(1, 120)),
        ];

        expect(verdicts.map((verdict) => verdict.admitted)).toEqual([true, true, false, true, false]);
        expect((await rowFor(first.pool, COOK))?.spent).toBe(120);
    });

    it('keeps each requester on its own budget', async () => {
        await first.budget.charge(charge(5, 5));

        expect((await first.budget.charge(charge(1, 5))).admitted).toBe(false);
        expect((await first.budget.charge(charge(1, 5, OTHER_COOK))).admitted).toBe(true);
    });

    it('fixes the window at the first charge, and later charges do not move it', async () => {
        await first.budget.charge(charge(1, 120));
        const opened = await rowFor(first.pool, COOK);

        await moveWindowEnd(first.pool, COOK, 1_000);
        await second.budget.charge(charge(1, 120));
        const later = await rowFor(first.pool, COOK);

        expect(opened?.secondsLeft).toBeGreaterThan(HOUR - 5);
        expect(opened?.secondsLeft).toBeLessThanOrEqual(HOUR);
        expect(later?.spent).toBe(2);
        expect(later?.secondsLeft).toBeGreaterThan(995);
        expect(later?.secondsLeft).toBeLessThanOrEqual(1_000);
    });

    it('opens a new window, with a fresh count, once the old one has ended', async () => {
        await first.budget.charge(charge(120, 120));
        expect((await first.budget.charge(charge(1, 120))).admitted).toBe(false);

        await moveWindowEnd(first.pool, COOK, -1);

        expect((await second.budget.charge(charge(7, 120))).admitted).toBe(true);
        const reopened = await rowFor(first.pool, COOK);

        expect(reopened?.spent).toBe(7);
        expect(reopened?.secondsLeft).toBeGreaterThan(HOUR - 5);
    });

    it('names the wait until the window ends, by the database clock', async () => {
        await first.budget.charge(charge(120, 120));
        await moveWindowEnd(first.pool, COOK, 100);

        const verdict = await second.budget.charge(charge(1, 120));

        expect(verdict).toEqual({ admitted: false, retryAfterSeconds: expect.any(Number) });
        expect(!verdict.admitted && verdict.retryAfterSeconds).toBeGreaterThanOrEqual(99);
        expect(!verdict.admitted && verdict.retryAfterSeconds).toBeLessThanOrEqual(100);
    });

    it('fails a charge whose row is locked within the statement bound, and leaves the pool unbounded', async () => {
        await first.budget.charge(charge(1, 120));
        const solo = openTask(1);
        const holder = new pg.Client({ connectionString: foodDb().appUrl });
        await holder.connect();

        try {
            const before = await statementTimeoutOf(solo.pool);

            await holder.query('BEGIN');
            await holder.query('SELECT 1 FROM requester_source_budget WHERE requester_id = $1 FOR UPDATE', [COOK]);

            // A monotonic clock: the wall clock can step while the charge waits.
            const started = performance.now();

            await expect(solo.budget.charge(charge(1, 120))).rejects.toThrow();
            expect(performance.now() - started).toBeLessThan(BUDGET_STATEMENT_TIMEOUT_MS + 2_000);
            // The bound was the charge's own, set for its transaction: the pooled session is as it was.
            expect(await statementTimeoutOf(solo.pool)).toBe(before);
            expect(before).not.toBe(`${BUDGET_STATEMENT_TIMEOUT_MS}ms`);
        } finally {
            await holder.query('ROLLBACK');
            await holder.end();
            await solo.pool.end();
        }

        // Nothing was charged by the failed attempt.
        expect((await rowFor(first.pool, COOK))?.spent).toBe(1);
    });

    describe('refunding the calls a request did not make', () => {
        it('gives back the unused calls to the window they were charged in, keeping the window', async () => {
            await first.budget.charge(charge(4, 120));
            const receipt = await admitted(second, charge(3, 120));
            const before = await rowFor(first.pool, COOK);

            await expect(first.budget.refund(receipt, 2)).resolves.toBe('refunded');

            const after = await rowFor(first.pool, COOK);

            expect(after?.spent).toBe(5);
            expect(after?.secondsLeft).toBeLessThanOrEqual(before?.secondsLeft ?? 0);
            expect(after?.secondsLeft).toBeGreaterThan((before?.secondsLeft ?? 0) - 5);
        });

        it('can give back every call, leaving the window open with nothing spent', async () => {
            const receipt = await admitted(first, charge(3, 120));

            await first.budget.refund(receipt, 3);

            expect((await rowFor(first.pool, COOK))?.spent).toBe(0);
        });

        // The receipt names its window to the microsecond; a JS Date would round it to the millisecond and match nothing.
        it('matches the window by its exact end, to the microsecond', async () => {
            await first.budget.charge(charge(1, 120));
            await first.pool.query(
                `UPDATE requester_source_budget
                    SET window_ends_at = date_trunc('second', window_ends_at) + interval '0.123457 second'
                  WHERE requester_id = $1`,
                [COOK],
            );
            const receipt = await admitted(second, charge(2, 120));

            await expect(first.budget.refund(receipt, 2)).resolves.toBe('refunded');
            expect((await rowFor(first.pool, COOK))?.spent).toBe(1);
        });

        // Calls charged after the window rolled over were made in the new window; giving them back would refund calls
        // that happened.
        it('gives nothing back once the window it was charged in has ended and a new one opened', async () => {
            const receipt = await admitted(first, charge(3, 120));

            await moveWindowEnd(first.pool, COOK, -1);
            await second.budget.charge(charge(5, 120));

            await expect(first.budget.refund(receipt, 3)).resolves.toBe('windowGone');
            expect((await rowFor(first.pool, COOK))?.spent).toBe(5);
        });

        it('never recreates a row the erasure sweep removed', async () => {
            const receipt = await admitted(first, charge(3, 120));

            await first.pool.query('DELETE FROM requester_source_budget WHERE requester_id = $1', [COOK]);

            await expect(first.budget.refund(receipt, 3)).resolves.toBe('windowGone');
            expect(await rowFor(first.pool, COOK)).toBeUndefined();
        });

        it("touches only the receipt's own requester", async () => {
            const receipt = await admitted(first, charge(3, 120));
            await first.budget.charge(charge(4, 120, OTHER_COOK));

            await first.budget.refund(receipt, 3);

            expect((await rowFor(first.pool, OTHER_COOK))?.spent).toBe(4);
        });

        // A refund below nothing spent is a second refund of the same calls: it fails loudly, never silently.
        it('fails a refund that would give back more than the window holds', async () => {
            const receipt = await admitted(first, charge(2, 120));

            await first.budget.refund(receipt, 2);

            await expect(first.budget.refund(receipt, 2)).rejects.toThrow();
            expect((await rowFor(first.pool, COOK))?.spent).toBe(0);
        });

        it.each([0, -1, 1.5, 4])('refuses to give back %s calls from a charge of 3, before any SQL', async (calls) => {
            const receipt = await admitted(first, charge(3, 120));

            await expect(first.budget.refund(receipt, calls)).rejects.toBeInstanceOf(RangeError);
            expect((await rowFor(first.pool, COOK))?.spent).toBe(3);
        });

        it('loses no charge when two tasks charge and refund at the same time', async () => {
            const receipts = await Promise.all(
                Array.from({ length: 8 }, async (_, index) =>
                    admitted(index % 2 === 0 ? first : second, charge(3, 120)),
                ),
            );

            // Each request gives back 2 of its 3 calls while 8 more requests charge 1 call each.
            const settled = await Promise.all([
                ...receipts.map(async (receipt, index) => (index % 2 === 0 ? second : first).budget.refund(receipt, 2)),
                ...Array.from({ length: 8 }, async (_, index) =>
                    (index % 2 === 0 ? first : second).budget.charge(charge(1, 120)),
                ),
            ]);

            expect(settled.filter((outcome) => outcome === 'refunded')).toHaveLength(8);
            expect((await rowFor(first.pool, COOK))?.spent).toBe(8 * 3 - 8 * 2 + 8);
        });
    });
});
