/**
 * Integration guarantee for user-erasure (T-056, FR-043/FR-044) over REAL Postgres. On a Clerk
 * `user.deleted` event the food service must remove the deleted user's footprint. `fetch_requesters`
 * is the ONLY per-user data this service stores (there are deliberately NO `user_fetch_quota`/
 * `global_fetch_quota` tables), so erasing a user = deleting that user's `fetch_requesters` rows; other
 * users' demand rows survive, foods remain shared reference data. Idempotent.
 *
 * (The wiring to the actual Clerk `user.deleted` webhook / deletion fan-out is infrastructure and is
 * out of scope here — see {@link UserErasureService} for the intended hook-in.)
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type pg from 'pg';

import { FetchQueueDao } from '../src/foods/dao/fetch-queue.dao.js';
import { FetchRequestersDao } from '../src/foods/dao/fetch-requesters.dao.js';
import { FoodDao } from '../src/foods/dao/food.dao.js';
import { UserErasureService } from '../src/foods/user-erasure.service.js';
import { DATABASE_URL, makeDb, makePool, resetSchema, type TestDb } from './support/db.js';

describe.skipIf(!DATABASE_URL)('user-erasure (integration, T-056/FR-044)', () => {
    let pool: pg.Pool;
    let db: TestDb;
    let foodDao: FoodDao;
    let queue: FetchQueueDao;
    let requesters: FetchRequestersDao;
    let erasure: UserErasureService;

    beforeAll(() => {
        pool = makePool();
        db = makeDb(pool);
        foodDao = new FoodDao(db);
        queue = new FetchQueueDao(db);
        requesters = new FetchRequestersDao(db);
        // The service resolves its own DAO from the Drizzle client (the DI token in production).
        erasure = new UserErasureService(db);
    });

    afterAll(async () => {
        await pool?.end();
    });

    beforeEach(async () => {
        await resetSchema(pool);
    });

    /** Create a PENDING food + pending queue row, attach `subs` as requesters. */
    async function seed(normalizedName: string, subs: string[]): Promise<string> {
        const { id } = await foodDao.createByName({ normalizedName, displayName: normalizedName });

        for (const requesterId of subs) {
            await requesters.add({ foodId: id, requesterId });
        }

        await queue.enqueue(id);

        return id;
    }

    it('deletes exactly the deleted user`s fetch_requesters rows across all foods, leaving others intact', async () => {
        const apple = await seed('apple', ['user_doomed', 'user_keep']);
        const pear = await seed('pear', ['user_doomed']);
        const kale = await seed('kale', ['user_keep']);

        const result = await erasure.eraseUser('user_doomed');

        expect(result).toEqual({ requesterId: 'user_doomed', deletedRequesterRows: 2 });

        // The deleted user is gone everywhere; the surviving user's rows remain.
        const remaining = await db.execute<{ requester_id: string }>(
            sql`SELECT requester_id FROM fetch_requesters ORDER BY requester_id`,
        );
        expect(remaining.rows.map((row) => row.requester_id)).toEqual(['user_keep', 'user_keep']);

        // Demand recomputes to the surviving distinct-requester count when next enqueued.
        await queue.enqueue(apple);
        expect((await queue.getByFoodId(apple))?.requestCount).toBe(1);
        expect(await requesters.countForFood(pear)).toBe(0);
        expect(await requesters.countForFood(kale)).toBe(1);

        // Foods themselves are shared reference data — never deleted by erasure.
        expect(await foodDao.getById(pear)).not.toBeNull();
    });

    it('is idempotent and reports zero when the user has no rows', async () => {
        await seed('quinoa', ['user_keep']);

        expect((await erasure.eraseUser('user_never_here')).deletedRequesterRows).toBe(0);
        // A re-run after a real deletion also returns zero.
        await erasure.eraseUser('user_keep');
        expect((await erasure.eraseUser('user_keep')).deletedRequesterRows).toBe(0);
    });

    it('no quota tables exist (fairness is by demotion, not a per-user quota)', async () => {
        const { rows } = await pool.query<{ relname: string }>(
            `SELECT relname FROM pg_class WHERE relname IN ('user_fetch_quota', 'global_fetch_quota')`,
        );
        expect(rows).toHaveLength(0);
    });
});
