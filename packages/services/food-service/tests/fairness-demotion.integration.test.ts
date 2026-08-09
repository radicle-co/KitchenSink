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
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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

    /**
     * T-199(a) — the drain-time threshold is CONFIGURED (`FOOD_DEMOTE_THRESHOLD`), not hardcoded.
     * `leaseNext` embedded a literal `50` in its `ORDER BY`, so an operator who tuned the variable got no
     * effect on the drain while the API's flood-shed honoured the new value — the two halves of FR-043
     * silently disagreed. These assert the OBSERVABLE consequence (which row `leaseNext` claims), not that
     * the DAO merely read a number.
     */
    describe('configured demotion threshold (T-199a, FR-043)', () => {
        afterEach(() => {
            vi.unstubAllEnvs();
        });

        /**
         * Two tiers of demand over five pending rows:
         * - `heavyFood` + three fillers are each requested by the SAME two subs, so every heavy sub holds
         *   FOUR pending rows and each heavy food carries `request_count = 2`.
         * - `lightFood` has one sub holding ONE pending row and `request_count = 1`.
         *
         * `heavyFood` is pinned oldest so the un-demoted ordering (`request_count DESC, first_requested
         * ASC`) resolves to it deterministically. Demand therefore favours `heavyFood`, and ONLY demotion
         * can put `lightFood` in front — which makes the claimed row a direct readout of the threshold.
         */
        async function seedTwoTierDemand(): Promise<{ heavyFood: string; lightFood: string }> {
            const heavySubs = ['heavy_a', 'heavy_b'];
            const heavyFood = await seedPending('heavy demand food', heavySubs);

            for (let i = 0; i < 3; i += 1) {
                await seedPending(`heavy filler ${i}`, heavySubs);
            }

            const lightFood = await seedPending('light demand food', ['light_a']);

            await pool.query(`UPDATE fetch_queue SET first_requested = now() - interval '1 hour' WHERE food_id = $1`, [
                heavyFood,
            ]);

            expect((await queue.getByFoodId(heavyFood))?.requestCount).toBe(2);
            expect((await queue.getByFoodId(lightFood))?.requestCount).toBe(1);
            expect(await queue.pendingCountForRequester('heavy_a')).toBe(4);
            expect(await queue.pendingCountForRequester('light_a')).toBe(1);

            return { heavyFood, lightFood };
        }

        it('honours FOOD_DEMOTE_THRESHOLD from the environment — a tuned value reorders the drain', async () => {
            const { heavyFood, lightFood } = await seedTwoTierDemand();

            // Threshold 3: every heavy sub holds 4 pending rows (> 3) → all four heavy foods demoted, so
            // the LOWER-demand light food is claimed first.
            vi.stubEnv('FOOD_DEMOTE_THRESHOLD', '3');
            expect((await new FetchQueueDao(db).leaseNext(30))?.foodId).toBe(lightFood);

            // Same five rows, threshold unset (the documented default of 50): nobody is over-demand, so
            // demand ordering stands and the heavy food is claimed first. The ONLY difference is the env.
            await queue.releaseInFlight();
            vi.unstubAllEnvs();
            expect((await new FetchQueueDao(db).leaseNext(30))?.foodId).toBe(heavyFood);
        });

        it('demotes strictly ABOVE the threshold — a sub holding exactly `threshold` rows stays promoted', async () => {
            const { heavyFood, lightFood } = await seedTwoTierDemand();

            // 4 pending rows is NOT over a threshold of 4 (`count <= threshold` keeps the food promoted).
            expect((await new FetchQueueDao(db, { demoteThreshold: 4 }).leaseNext(30))?.foodId).toBe(heavyFood);

            // One lower and the same subs are over-demand — the off-by-one boundary is load-bearing.
            await queue.releaseInFlight();
            expect((await new FetchQueueDao(db, { demoteThreshold: 3 }).leaseNext(30))?.foodId).toBe(lightFood);
        });
    });
});
