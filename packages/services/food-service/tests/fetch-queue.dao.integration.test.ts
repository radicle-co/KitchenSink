/**
 * Integration suite for {@link FetchQueueDao} + {@link FetchRequestersDao} (T-109): idempotent
 * enqueue, distinct-requester `request_count` (each `sub` at most once — NEVER a raw `+1`), the
 * demand-weighted `FOR UPDATE SKIP LOCKED` drain order, the `leased_at` lease + reaper reclaim, the
 * live per-`sub` pending count, and requester pruning when a food leaves the queue
 * (FR-014, FR-015, FR-018, FR-043, FR-044).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';

import { FoodDao } from '../src/foods/dao/food.dao.js';
import { FetchQueueDao } from '../src/foods/dao/fetch-queue.dao.js';
import { FetchRequestersDao } from '../src/foods/dao/fetch-requesters.dao.js';
import { DATABASE_URL, makeDb, makePool, resetSchema, type TestDb } from './support/db.js';

describe.skipIf(!DATABASE_URL)('FetchQueueDao + FetchRequestersDao (integration)', () => {
    let pool: pg.Pool;
    let db: TestDb;
    let foods: FoodDao;
    let queue: FetchQueueDao;
    let requesters: FetchRequestersDao;

    beforeAll(async () => {
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
        await resetSchema(pool);
    });

    describe('distinct-requester demand (FR-044, DSN-3)', () => {
        it('50 adds by ONE sub → request_count = 1 (a sub cannot inflate priority)', async () => {
            const { id } = await foods.createByName({ normalizedName: 'banana' });

            for (let i = 0; i < 50; i += 1) {
                await requesters.add({ foodId: id, requesterId: 'user_solo' });
            }

            const row = await queue.enqueue(id);

            expect(row.requestCount).toBe(1);
            expect(await requesters.countForFood(id)).toBe(1);
        });

        it('N distinct subs → request_count = N', async () => {
            const { id } = await foods.createByName({ normalizedName: 'cucumber' });

            for (let i = 0; i < 7; i += 1) {
                await requesters.add({ foodId: id, requesterId: `user_${i}` });
            }

            const row = await queue.enqueue(id);

            expect(row.requestCount).toBe(7);
        });

        it('enqueue is idempotent on food_id (one row) and reflects later distinct adds', async () => {
            const { id } = await foods.createByName({ normalizedName: 'tomato' });
            await requesters.add({ foodId: id, requesterId: 'a' });
            await queue.enqueue(id);
            await requesters.add({ foodId: id, requesterId: 'b' });
            const row = await queue.enqueue(id);

            expect(row.requestCount).toBe(2);
            const { rows } = await pool.query<{ count: string }>(
                `SELECT count(*) AS count FROM fetch_queue WHERE food_id = $1`,
                [id],
            );
            expect(rows[0]?.count).toBe('1');
        });
    });

    describe('demand-weighted drain (FR-015) + lease (FR-017)', () => {
        it('leaseNext claims highest request_count first and stamps leased_at + in_flight', async () => {
            const low = await foods.createByName({ normalizedName: 'low demand' });
            const high = await foods.createByName({ normalizedName: 'high demand' });
            await requesters.add({ foodId: low.id, requesterId: 'a' });
            await queue.enqueue(low.id);
            await requesters.add({ foodId: high.id, requesterId: 'a' });
            await requesters.add({ foodId: high.id, requesterId: 'b' });
            await requesters.add({ foodId: high.id, requesterId: 'c' });
            await queue.enqueue(high.id);

            const leased = await queue.leaseNext(30);
            expect(leased?.foodId).toBe(high.id);
            expect(leased?.status).toBe('in_flight');
            expect(leased?.leasedAt).not.toBeNull();
        });

        it('leaseNext skips an already in_flight (freshly leased) row (FOR UPDATE SKIP LOCKED)', async () => {
            const a = await foods.createByName({ normalizedName: 'a food' });
            const b = await foods.createByName({ normalizedName: 'b food' });
            await requesters.add({ foodId: a.id, requesterId: 'x' });
            await queue.enqueue(a.id);
            await requesters.add({ foodId: b.id, requesterId: 'y' });
            await queue.enqueue(b.id);

            const first = await queue.leaseNext(30);
            const second = await queue.leaseNext(30);
            expect(first?.foodId).not.toBe(second?.foodId);
            const third = await queue.leaseNext(30);
            expect(third).toBeUndefined();
        });
    });

    describe('reaper reclaim of a stale in_flight lease (FR-018)', () => {
        it('reapExpiredLeases reverts an in_flight row whose leased_at is older than the timeout → pending', async () => {
            const { id } = await foods.createByName({ normalizedName: 'stale food' });
            await requesters.add({ foodId: id, requesterId: 'a' });
            await queue.enqueue(id);
            // Lease it, then backdate the lease so it appears expired.
            await queue.leaseNext(30);
            await pool.query(`UPDATE fetch_queue SET leased_at = now() - interval '120 seconds' WHERE food_id = $1`, [
                id,
            ]);

            const reclaimed = await queue.reapExpiredLeases(30);
            expect(reclaimed).toBe(1);
            const row = await queue.getByFoodId(id);
            expect(row?.status).toBe('pending');
        });

        it('leaseNext itself reclaims a stale in_flight row (reaper-on-claim) WITHOUT touching attempts', async () => {
            const { id } = await foods.createByName({ normalizedName: 'orphan food' });
            await requesters.add({ foodId: id, requesterId: 'a' });
            await queue.enqueue(id);
            await queue.leaseNext(30);
            await pool.query(`UPDATE fetch_queue SET leased_at = now() - interval '120 seconds' WHERE food_id = $1`, [
                id,
            ]);

            const reclaimed = await queue.leaseNext(30);
            expect(reclaimed?.foodId).toBe(id);
            expect(reclaimed?.attempts).toBe(0);
        });
    });

    describe('fairness + lifecycle', () => {
        it("pendingCountForRequester counts a sub's pending queue rows (FR-043)", async () => {
            const f1 = await foods.createByName({ normalizedName: 'f1' });
            const f2 = await foods.createByName({ normalizedName: 'f2' });
            await requesters.add({ foodId: f1.id, requesterId: 'heavy' });
            await queue.enqueue(f1.id);
            await requesters.add({ foodId: f2.id, requesterId: 'heavy' });
            await queue.enqueue(f2.id);

            expect(await queue.pendingCountForRequester('heavy')).toBe(2);
        });

        it('resolve prunes the queue row AND its requester rows (DSN-10)', async () => {
            const { id } = await foods.createByName({ normalizedName: 'resolved food' });
            await requesters.add({ foodId: id, requesterId: 'a' });
            await requesters.add({ foodId: id, requesterId: 'b' });
            await queue.enqueue(id);

            await queue.resolve(id);
            expect(await queue.getByFoodId(id)).toBeUndefined();
            expect(await requesters.countForFood(id)).toBe(0);
        });

        it('tombstone marks the row and prunes requesters', async () => {
            const { id } = await foods.createByName({ normalizedName: 'gone food' });
            await requesters.add({ foodId: id, requesterId: 'a' });
            await queue.enqueue(id);

            await queue.tombstone(id, 'exhausted');
            const row = await queue.getByFoodId(id);
            expect(row?.status).toBe('tombstone');
            expect(row?.lastError).toBe('exhausted');
            expect(await requesters.countForFood(id)).toBe(0);
        });

        it('reactivate revives a tombstone row → pending, clearing failure/lease bookkeeping (FR-028a)', async () => {
            const { id } = await foods.createByName({ normalizedName: 'revived food' });
            await requesters.add({ foodId: id, requesterId: 'a' });
            await queue.enqueue(id);
            await queue.tombstone(id, 'exhausted');

            await requesters.add({ foodId: id, requesterId: 'a' });
            const row = await queue.reactivate(id);
            expect(row.status).toBe('pending');
            expect(row.attempts).toBe(0);
            expect(row.leasedAt).toBeNull();
            expect(row.lastError).toBeNull();
        });
    });

    describe('pendingAgeSeconds (T-183 freshness alarm signal)', () => {
        it('returns 0 when no row is pending', async () => {
            expect(await queue.pendingAgeSeconds()).toBe(0);
        });

        it('returns the age in seconds of the OLDEST pending row, ignoring in_flight/tombstone rows', async () => {
            const stale = await foods.createByName({ normalizedName: 'stale pending' });
            await requesters.add({ foodId: stale.id, requesterId: 'a' });
            await queue.enqueue(stale.id);
            // Backdate first_requested by 10 minutes so the oldest-pending age is deterministic.
            await pool.query(
                `UPDATE fetch_queue SET first_requested = now() - interval '600 seconds' WHERE food_id = $1`,
                [stale.id],
            );

            const fresh = await foods.createByName({ normalizedName: 'fresh pending' });
            await requesters.add({ foodId: fresh.id, requesterId: 'b' });
            await queue.enqueue(fresh.id);

            const age = await queue.pendingAgeSeconds();

            expect(age).toBeGreaterThanOrEqual(590);
        });
    });
});
