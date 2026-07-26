/**
 * Integration guarantee for fairness-by-demotion (T-049, FR-043/FR-043a/SC-012) and distinct-requester
 * demand counting (T-050, FR-044) over REAL Postgres. The drain-time demotion + distinct-`sub` counting
 * live in {@link FetchQueueDao} (`leaseNext`/`enqueue`); this suite is the auth-side guarantee:
 *
 * - A food whose requesters ALL exceed the 50-pending threshold is ranked to the BACK (demoted) while a
 *   food with an under-threshold requester drains first — and is auto re-promoted the moment ANY of its
 *   requesters drops below the threshold. No request is ever rejected with `429` (demotion, not a quota).
 * - One `sub`'s repeated adds CANNOT inflate priority: `request_count` is the distinct-`sub` count
 *   (structural `PRIORITY_CAP=1` via the `(food_id, requester_id)` PK), so genuine multi-requester demand wins.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';

import { FetchQueueDao } from '../src/foods/dao/fetch-queue.dao.js';
import { FetchRequestersDao } from '../src/foods/dao/fetch-requesters.dao.js';
import { FoodDao } from '../src/foods/dao/food.dao.js';
import { DATABASE_URL, makeDb, makePool, resetSchema, type TestDb } from './support/db.js';

describe.skipIf(!DATABASE_URL)('fairness-by-demotion + distinct-requester demand (integration)', () => {
    let pool: pg.Pool;
    let db: TestDb;
    let foodDao: FoodDao;
    let queue: FetchQueueDao;
    let requesters: FetchRequestersDao;

    beforeAll(() => {
        pool = makePool();
        db = makeDb(pool);
        foodDao = new FoodDao(db);
        queue = new FetchQueueDao(db);
        requesters = new FetchRequestersDao(db);
    });

    afterAll(async () => {
        await pool?.end();
    });

    beforeEach(async () => {
        await resetSchema(pool);
    });

    /** Create a PENDING food + its pending queue row, attach `subs` as distinct requesters, recompute demand. */
    async function seedPending(normalizedName: string, subs: string[]): Promise<string> {
        const { id } = await foodDao.createByName({ normalizedName, displayName: normalizedName });

        for (const requesterId of subs) {
            await requesters.add({ foodId: id, requesterId });
        }

        await queue.enqueue(id);

        return id;
    }

    it('demotes a food whose ALL requesters exceed 50 pending while a lighter food drains first (SC-012, no 429)', async () => {
        // Flooder pins 60 distinct foods pending → its pending count (60) exceeds the 50 threshold.
        const flooderFoods: string[] = [];
        for (let i = 0; i < 60; i += 1) {
            flooderFoods.push(await seedPending(`flooder food ${i}`, ['flooder']));
        }

        // A light user adds one food (its only requester is under-threshold).
        const lightFood = await seedPending('light user food', ['light']);

        // All foods tie at request_count = 1, so ONLY demotion decides order: the light food leases first
        // even though it was enqueued last, because every flooder food is demoted to the back.
        const leased = await queue.leaseNext(30);
        expect(leased?.foodId).toBe(lightFood);

        // Nothing was rejected — every food is still queued/drainable (work-conserving, no per-user 429).
        expect(flooderFoods).toHaveLength(60);
    });

    it('auto re-promotes a demoted food the instant ANY one requester drops below the threshold (FR-043a)', async () => {
        // Two heavy foods, both initially demoted (their only requester floods 55 pending foods).
        for (let i = 0; i < 53; i += 1) {
            await seedPending(`flooder filler ${i}`, ['flooder']);
        }
        const heavyA = await seedPending('heavy A', ['flooder']); // 54th flooder food
        await seedPending('heavy B', ['flooder']); // 55th flooder food (also demoted)
        const lightFood = await seedPending('light food', ['light']);

        // Baseline: both heavy foods are demoted → the light food wins.
        expect((await queue.leaseNext(30))?.foodId).toBe(lightFood);
        // reset the lease so ordering is judged fresh.
        await pool.query(`UPDATE fetch_queue SET status='pending', leased_at=NULL`);

        // Add a SECOND, under-threshold requester to heavyA → not ALL its requesters exceed 50 → promoted.
        await requesters.add({ foodId: heavyA, requesterId: 'fresh_light' });
        await queue.enqueue(heavyA); // recompute demand: heavyA now distinct-count = 2

        const leased = await queue.leaseNext(30);
        expect(leased?.foodId).toBe(heavyA); // promoted AND higher distinct demand → leases first
        expect(leased?.requestCount).toBe(2);
    });

    it('distinct-requester demand: one sub repeating cannot out-prioritize genuine multi-requester demand (FR-044)', async () => {
        const repeated = await foodDao.createByName({ normalizedName: 'repeated', displayName: 'repeated' });

        // One requester "adds" the same food five times — the (food_id, requester_id) PK collapses to ONE row.
        for (let i = 0; i < 5; i += 1) {
            await requesters.add({ foodId: repeated.id, requesterId: 'repeater' });
        }
        await queue.enqueue(repeated.id);

        // A genuinely more-demanded food: three DISTINCT requesters.
        const popular = await seedPending('popular', ['ann', 'bob', 'cara']);

        expect((await queue.getByFoodId(repeated.id))?.requestCount).toBe(1); // PRIORITY_CAP=1 per sub
        expect((await queue.getByFoodId(popular))?.requestCount).toBe(3);
        expect(await requesters.countForFood(repeated.id)).toBe(1); // structural, not LEAST(count,1)

        // Higher distinct demand drains first — the repeater cannot pin its single-requester food ahead.
        expect((await queue.leaseNext(30))?.foodId).toBe(popular);
    });
});
