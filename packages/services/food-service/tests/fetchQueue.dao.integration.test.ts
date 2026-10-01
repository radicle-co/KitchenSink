/**
 * Integration suite for {@link FetchQueueDao} + {@link FetchRequestersDao} (T-109): idempotent
 * enqueue, distinct-requester `request_count` (each `sub` at most once — NEVER a raw `+1`), the
 * demand-weighted `FOR UPDATE SKIP LOCKED` drain order, the `leased_at` lease + reaper reclaim, the
 * live per-`sub` pending count, and requester pruning when a food leaves the queue
 * (FR-014, FR-015, FR-018, FR-043, FR-044).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type pg from 'pg';

import { FoodDao } from '../src/foods/dao/food.dao.js';
import { FetchQueueDao } from '../src/foods/dao/fetchQueue.dao.js';
import { isLeaseLostError, leaseFenceFrom, type LeaseFence } from '../src/foods/dao/leaseFence.js';
import { FetchRequestersDao } from '../src/foods/dao/fetchRequesters.dao.js';
import { makeDb, makePool, type TestDb } from './support/db.js';
import { foodDb, hasTestDatabase } from './support/roleDb.js';

describe.skipIf(!hasTestDatabase)('FetchQueueDao + FetchRequestersDao (integration)', () => {
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
        await foodDb().truncate();
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

        /**
         * T-150 — the lease window is CONFIGURED (`FOOD_LEASE_TIMEOUT_SECONDS`), not the module literal 30
         * the DAO used to carry (with a third copy in `FoodConsumerService`). Raising it is what stops the
         * reaper stealing a row from a slow-but-live worker mid-fan-out; lowering it is what recovers a row
         * faster after a task is killed. Neither worked before, and neither said so.
         *
         * A fresh `FetchQueueDao` is built per case because the window is resolved at construction.
         */
        describe('the configured lease window (FR-018)', () => {
            afterEach(() => {
                vi.unstubAllEnvs();
            });

            /** Enqueue a food, lease it, and backdate the lease by `seconds`. */
            async function leasedAndBackdated(name: string, seconds: number): Promise<string> {
                const { id } = await foods.createByName({ normalizedName: name });
                await requesters.add({ foodId: id, requesterId: 'a' });
                await queue.enqueue(id);
                await queue.leaseNext(30);
                await pool.query(
                    `UPDATE fetch_queue SET leased_at = now() - make_interval(secs => $2) WHERE food_id = $1`,
                    [id, seconds],
                );

                return id;
            }

            it('reclaims a 15s-old lease when the window is tuned DOWN to 10s (the default 30 would not)', async () => {
                const id = await leasedAndBackdated('short-lease food', 15);

                vi.stubEnv('FOOD_LEASE_TIMEOUT_SECONDS', '10');

                expect(await new FetchQueueDao(db).reapExpiredLeases()).toBe(1);
                expect((await queue.getByFoodId(id))?.status).toBe('pending');
            });

            it('leaves that same lease ALONE when the window is tuned UP to 300s', async () => {
                const id = await leasedAndBackdated('long-lease food', 60);

                vi.stubEnv('FOOD_LEASE_TIMEOUT_SECONDS', '300');

                expect(await new FetchQueueDao(db).reapExpiredLeases()).toBe(0);
                expect((await queue.getByFoodId(id))?.status).toBe('in_flight');
            });

            it("applies the configured window to leaseNext's reaper-on-claim, so a drain reclaims it too", async () => {
                const id = await leasedAndBackdated('claim-lease food', 15);

                vi.stubEnv('FOOD_LEASE_TIMEOUT_SECONDS', '10');

                // Under the old literal 30s window this row is not yet expired, so the claim finds nothing.
                expect((await new FetchQueueDao(db).leaseNext())?.foodId).toBe(id);
            });
        });
    });

    /**
     * ⛔ THE LEASE FENCE (U5/R16). A lease that can lapse is only half a claim: the reaper reverts the row
     * to `pending`, a second loop claims it, and the FIRST loop — still running, unaware — then lands its
     * result on a row it no longer owns. Two workers fetch the same food, and one of them overwrites the
     * other's outcome with nothing to show it happened.
     *
     * So every settle carries the `leased_at` stamp its claim wrote, and the statement asks for it: a
     * settle whose claim was reaped matches zero rows and is REFUSED, never applied.
     *
     * ⚠️ Each case takes its fence from a real `leaseNext`, never constructs one. `leased_at` is stored to
     * MICROSECONDS while a JS `Date` carries milliseconds, so a fence built or round-tripped through
     * `Date` is truncated and matches nothing — a suite that minted its own fence would pass while every
     * settle in production threw. That is why the fence is an opaque string, and why `staleFence` below is
     * derived by asking Postgres for one rather than by subtracting from a `Date`.
     */
    describe('the lease fence (R16)', () => {
        /** Enqueue one food and claim it, returning the id and the claim's fence. */
        async function claimed(name: string): Promise<{ id: string; fence: LeaseFence }> {
            const { id } = await foods.createByName({ normalizedName: name });
            await requesters.add({ foodId: id, requesterId: 'a' });
            await queue.enqueue(id);
            const row = await queue.leaseNext();

            expect(row?.foodId).toBe(id);

            return { id, fence: row!.fence };
        }

        /**
         * ⛔ FR-018 says the reaper reverts the row to `pending` **and clears `leased_at`**, and the
         * statement did only the first half — leaving a stamp on a row nobody held, where every sibling
         * release (`recordFailure`, `deferLease`, `releaseInFlight`) clears it. That made the reaped row
         * the one place in the table where `leased_at` did not mean "this row is claimed", which is
         * exactly the reading the fence is built on.
         */
        it('⛔ the reaper CLEARS the stamp it reverts, so a pending row never carries a lease (FR-018)', async () => {
            const { id } = await claimed('reaped stamp');
            await ageClaim(id, 10_000);

            expect(await queue.reapExpiredLeases()).toBe(1);

            const row = await queue.getByFoodId(id);
            expect(row?.status).toBe('pending');
            expect(row?.leasedAt).toBeNull();
        });

        /** Back-date a live claim by `seconds`, returning the fence the aged row now carries. */
        async function ageClaim(foodId: string, seconds: number): Promise<LeaseFence> {
            const { rows } = await pool.query<{ fence: string }>(
                `UPDATE fetch_queue SET leased_at = now() - make_interval(secs => $2)
                  WHERE food_id = $1 RETURNING leased_at::text AS fence`,
                [foodId, seconds],
            );

            return leaseFenceFrom(rows[0]!.fence);
        }

        /** A syntactically valid fence that no row carries — what a reaped-then-reclaimed claim holds. */
        async function otherFence(): Promise<LeaseFence> {
            const { rows } = await pool.query<{ t: string }>(`SELECT (now() - interval '1 hour')::text AS t`);

            return leaseFenceFrom(rows[0]!.t);
        }

        it('a settle carrying the claim it made lands normally', async () => {
            const { id, fence } = await claimed('fenced happy path');

            await queue.resolve(id, fence);

            expect(await queue.getByFoodId(id)).toBeUndefined();
        });

        it('⛔ a REAPED claim cannot resolve the row — the settle is refused and the row survives', async () => {
            const { id, fence } = await claimed('reaped resolve');
            // The reaper reverts the row; a second worker is now free to claim it.
            await pool.query(`UPDATE fetch_queue SET status = 'pending' WHERE food_id = $1`, [id]);

            await expect(queue.resolve(id, fence)).rejects.toSatisfy(isLeaseLostError);
            expect((await queue.getByFoodId(id))?.status).toBe('pending');
            // The requester prune is inside the same transaction, so a refused settle takes nothing with it.
            expect(await requesters.countForFood(id)).toBe(1);
        });

        it("⛔ a RECLAIMED row refuses the first claim's settle — the stamp moved, so the claim is stale", async () => {
            const { id, fence } = await claimed('reclaimed row');
            await pool.query(`UPDATE fetch_queue SET status = 'pending' WHERE food_id = $1`, [id]);
            const second = await queue.leaseNext();

            expect(second?.foodId).toBe(id);
            expect(second?.fence).not.toBe(fence);

            await expect(queue.resolve(id, fence)).rejects.toSatisfy(isLeaseLostError);
            // ...and the loop that actually holds the row can still settle it.
            await queue.resolve(id, second!.fence);
            expect(await queue.getByFoodId(id)).toBeUndefined();
        });

        it('⛔ a reaped claim cannot TOMBSTONE the row — the food is not condemned by a stale loop', async () => {
            const { id } = await claimed('reaped tombstone');
            const stale = await otherFence();

            await expect(queue.tombstone(id, 'no_source_has_item', stale)).rejects.toSatisfy(isLeaseLostError);
            expect((await queue.getByFoodId(id))?.status).toBe('in_flight');
            expect(await requesters.countForFood(id)).toBe(1);
        });

        it("⛔ a reaped claim cannot RECORD A FAILURE — it cannot spend another loop's retry budget", async () => {
            const { id } = await claimed('reaped failure');
            const stale = await otherFence();

            await expect(queue.recordFailure(id, 'all_sources_errored', stale)).rejects.toSatisfy(isLeaseLostError);
            expect((await queue.getByFoodId(id))?.attempts).toBe(0);
        });

        it('⛔ a reaped claim cannot DEFER the row — it cannot push back work it no longer owns', async () => {
            const { id } = await claimed('reaped defer');
            const stale = await otherFence();

            await expect(queue.deferLease(id, 60, stale)).rejects.toSatisfy(isLeaseLostError);
            expect((await queue.getByFoodId(id))?.status).toBe('in_flight');
        });

        /**
         * `corroborateFood` holds no lease — it is an API caller completing a food out of band — so it
         * MUST be able to clear the row. The bypass is a literal at the call site rather than an omitted
         * argument, so it can be grepped and cannot be reached by forgetting something.
         */
        it("'out-of-band' clears a leased row, and is idempotent on a row that has already gone", async () => {
            const { id } = await claimed('out of band');

            await queue.resolve(id, 'out-of-band');

            expect(await queue.getByFoodId(id)).toBeUndefined();
            await expect(queue.resolve(id, 'out-of-band')).resolves.toBeUndefined();
        });

        /**
         * The plan's second U5 scenario: "one fetch that outlasts the old 30-second lease is not claimed
         * twice". The configured window is the derived floor, so a claim that has been working for 40
         * seconds — well past the old literal — is still ITS row.
         */
        it('⛔ a 40s-old claim is NOT reclaimed under the derived window, though 30s would have lost it', async () => {
            const { id } = await claimed('slow but alive');
            // ⚠️ Ageing the claim MOVES the fence — the stamp IS the fence — so the aged claim's authority
            // is whatever the row now carries. Reusing the pre-ageing value would prove the fence works
            // (it would be refused) while proving nothing about the window, which is what this case is for.
            const aged = await ageClaim(id, 40);

            expect(await queue.reapExpiredLeases()).toBe(0);
            expect(await queue.leaseNext()).toBeUndefined();
            // Its settle still lands, because nothing took the row away from it.
            await queue.resolve(id, aged);
            expect(await queue.getByFoodId(id)).toBeUndefined();

            // Mutation guard: at FR-018's original 30s the very same row IS reclaimed. The window is what
            // makes the difference, not the fixture.
            const { id: other } = await claimed('slow under the old window');
            await ageClaim(other, 40);
            expect(await queue.reapExpiredLeases(30)).toBe(1);
        });
    });

    /**
     * ⚠️ The lifecycle cases below settle `'out-of-band'`: they assert what `resolve`/`tombstone` DO to
     * the rows, driven directly, with no worker claim behind them. The fenced path — what those same
     * settles REFUSE — is proved in "the lease fence" above, not here.
     */
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

            await queue.resolve(id, 'out-of-band');
            expect(await queue.getByFoodId(id)).toBeUndefined();
            expect(await requesters.countForFood(id)).toBe(0);
        });

        it('tombstone marks the row and prunes requesters', async () => {
            const { id } = await foods.createByName({ normalizedName: 'gone food' });
            await requesters.add({ foodId: id, requesterId: 'a' });
            await queue.enqueue(id);

            await queue.tombstone(id, 'exhausted', 'out-of-band');
            const row = await queue.getByFoodId(id);
            expect(row?.status).toBe('tombstone');
            expect(row?.lastError).toBe('exhausted');
            expect(await requesters.countForFood(id)).toBe(0);
        });

        it('reactivate revives a tombstone row → pending, clearing failure/lease bookkeeping (FR-028a)', async () => {
            const { id } = await foods.createByName({ normalizedName: 'revived food' });
            await requesters.add({ foodId: id, requesterId: 'a' });
            await queue.enqueue(id);
            await queue.tombstone(id, 'exhausted', 'out-of-band');

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
