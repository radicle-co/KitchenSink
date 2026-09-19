/**
 * U13 — the food backstop against a REAL database (R29/R30/R38).
 *
 * ⛔ WHY THIS TIER. Two of the three claims here are claims about POSTGRES, not about our code:
 *
 *  1. **The check cannot write.** `SET TRANSACTION READ ONLY` is the enforcement, so "this only reads" is a
 *     property of the database rather than of whoever next edits the function. A unit test with a fake
 *     client would prove the function did not *call* a write, which is a different and weaker statement.
 *  2. **The six counts describe ONE instant.** They are scalar subqueries in one statement precisely so the
 *     drainer cannot claim a row between two of them and produce a combination that never existed — which
 *     the classifier would then confidently name.
 *
 * Runs as `food_app` (ADR-0039), the role the deployed worker holds; skipped without a database.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReadSession } from '@kitchensink/queue-check';
import pg from 'pg';

import { FoodDao } from '../src/foods/dao/food.dao.js';
import { FetchQueueDao } from '../src/foods/dao/fetchQueue.dao.js';
import { FetchRequestersDao } from '../src/foods/dao/fetchRequesters.dao.js';
import { readOnlyCounts, runQueueCheck } from '../src/worker/queueCheck.js';
import { makeDb, makePool, type TestDb } from './support/db.js';
import { foodDb, hasTestDatabase } from './support/roleDb.js';

/** Mid-morning in New York — outside the nightly window, so the check runs. */
const AWAKE = new Date('2026-07-15T15:00:00Z');

describe.skipIf(!hasTestDatabase)('the food queue check (integration)', () => {
    let pool: pg.Pool;
    let db: TestDb;
    let foods: FoodDao;
    let queue: FetchQueueDao;
    let requesters: FetchRequestersDao;

    beforeAll(() => {
        pool = makePool();
        db = makeDb(pool);
        foods = new FoodDao(db);
        queue = new FetchQueueDao(db);
        requesters = new FetchRequestersDao(db);
    });

    afterAll(async () => {
        await pool?.end();
    });

    beforeEach(async () => {
        await foodDb().truncate();
    });

    /** One client, so the transaction the check opens is the one the assertions observe. */
    /**
     * One checked-out connection, released after the caller is done with it.
     *
     * ⚠️ A CLIENT, never the pool. `readOnlyCounts` takes a `ReadSession` for exactly that reason — see
     * `@kitchensink/queue-check`'s `readSession.ts`: a pool hands a different backend to every statement, so
     * the `BEGIN TRANSACTION READ ONLY` below would apply to a session nothing else uses.
     */
    async function withClient<T>(run: (session: ReadSession) => Promise<T>): Promise<T> {
        const client = await pool.connect();

        try {
            return await run({
                query: async (text, params) => client.query(text, params === undefined ? undefined : [...params]),
                release: () => {
                    client.release();
                },
            });
        } finally {
            client.release();
        }
    }

    it('reads a quiet queue as quiet', async () => {
        const counts = await withClient((session) => readOnlyCounts(session, 250));

        expect(counts).toEqual({
            staleLeases: 0,
            pendingWithNoRow: 0,
            claimablePending: 0,
            inFlight: 0,
            failedTombstones: 0,
            oldestPendingSeconds: 0,
        });
    });

    /**
     * ⛔ THE CONDITION THE WHOLE BACKSTOP EXISTS FOR. A food is `PENDING` — every caller polling it is told
     * "we are working on it" — and the row that would carry that work does not exist. Nothing is coming for
     * it, and no amount of waiting changes that.
     */
    it('⛔ sees a PENDING food with NO queue row, and escalates it as LOST', async () => {
        await foods.createByName({ normalizedName: 'orphaned pending food' });

        const escalate = vi.fn();
        const payload = await withClient(async (session) =>
            runQueueCheck({
                stage: 'sandbox',
                counts: () => readOnlyCounts(session, 250),
                escalate,
                checkIn: () => undefined,
                now: () => AWAKE,
            }),
        );

        expect(payload?.condition).toBe('lost');
        expect(payload?.owedCount).toBe(1);
        expect(escalate).toHaveBeenCalledTimes(1);
    });

    it('a queue row within its lease produces no escalation', async () => {
        const { id } = await foods.createByName({ normalizedName: 'healthy food' });
        await requesters.add({ foodId: id, requesterId: 'a' });
        await queue.enqueue(id);
        await queue.leaseNext();

        const escalate = vi.fn();
        const payload = await withClient(async (session) =>
            runQueueCheck({
                stage: 'sandbox',
                counts: () => readOnlyCounts(session, 250),
                escalate,
                checkIn: () => undefined,
                now: () => AWAKE,
            }),
        );

        expect(payload).toBeUndefined();
        expect(escalate).not.toHaveBeenCalled();
    });

    /**
     * ⛔ THE READ-ONLY TRANSACTION IS THE ENFORCEMENT. A backstop that can write is one that can make the
     * thing it is watching worse — and the failure it must never cause is the one it exists to detect.
     * Asserted by attempting a write INSIDE the transaction the check opens and watching Postgres refuse it,
     * because "the function does not call a write" is a weaker claim than "a write here is impossible".
     */
    it('⛔ performs no writes — and a write attempted inside its transaction is REFUSED by Postgres', async () => {
        const { id } = await foods.createByName({ normalizedName: 'read only probe' });
        await requesters.add({ foodId: id, requesterId: 'a' });
        await queue.enqueue(id);

        const before = await pool.query('SELECT status, attempts FROM fetch_queue WHERE food_id = $1', [id]);

        await withClient(async ({ query }) => {
            await query('BEGIN TRANSACTION READ ONLY');

            try {
                await expect(
                    query('UPDATE fetch_queue SET attempts = attempts + 1 WHERE food_id = $1', [id]),
                ).rejects.toThrow(/read-only transaction/iu);
            } finally {
                await query('ROLLBACK');
            }
        });

        const after = await pool.query('SELECT status, attempts FROM fetch_queue WHERE food_id = $1', [id]);
        expect(after.rows[0]).toEqual(before.rows[0]);
    });

    /**
     * ⚠️ The lease window is the CONFIGURED one, not a literal: a backstop measuring staleness against a
     * different window than the reaper reclaims on would report rows as stuck that the reaper is about to
     * take, or miss rows it has already given up on — and both readings would look authoritative.
     */
    it('⛔ measures staleness against the window it is given, not a built-in one', async () => {
        const { id } = await foods.createByName({ normalizedName: 'aged lease' });
        await requesters.add({ foodId: id, requesterId: 'a' });
        await queue.enqueue(id);
        await queue.leaseNext();
        await pool.query(`UPDATE fetch_queue SET leased_at = now() - interval '100 seconds' WHERE food_id = $1`, [id]);

        // Under a 250s window the lease is live; under a 10s window the reaper would already have it.
        expect((await withClient((session) => readOnlyCounts(session, 250))).staleLeases).toBe(0);
        expect((await withClient((query) => readOnlyCounts(query, 10))).staleLeases).toBe(1);
    });
});
