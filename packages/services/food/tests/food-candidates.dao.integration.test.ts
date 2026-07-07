/**
 * Integration suite for {@link CandidateStore} (T-111 DAO): persist a food's candidate set,
 * list it (TTL-filtered), validate a pick is a member, and clear it on resolve. Anchored on
 * `created_at` for the 30-day candidate-set TTL (FR-025a, FR-RES-1, FR-RES-2, FR-MRG-5).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';

import { FoodDao } from '../src/foods/dao/food.dao.js';
import { CandidateStore } from '../src/foods/dao/food-candidates.dao.js';
import { DATABASE_URL, makeDb, makePool, resetSchema, type TestDb } from './support/db.js';

describe.skipIf(!DATABASE_URL)('CandidateStore (integration)', () => {
    let pool: pg.Pool;
    let db: TestDb;
    let foods: FoodDao;
    let store: CandidateStore;

    beforeAll(async () => {
        pool = makePool();
        db = makeDb(pool);
        foods = new FoodDao(db);
        store = new CandidateStore(db);
    });

    afterAll(async () => {
        await pool?.end();
    });

    beforeEach(async () => {
        await resetSchema(pool);
    });

    it('persistCandidates writes the surviving set and getCandidates lists it', async () => {
        const { id: foodId } = await foods.createByName({ normalizedName: 'broccoli' });
        await store.persistCandidates({
            foodId,
            candidates: [
                { source: 'usda', externalKey: '170379', name: 'Broccoli, raw' },
                { source: 'usda', externalKey: '169967', name: 'Broccoli, cooked', summary: 'boiled' },
            ],
        });

        const list = await store.getCandidates(foodId);
        expect(list).toHaveLength(2);
        expect(list.map((c) => c.externalKey).sort()).toEqual(['169967', '170379']);
    });

    it('persistCandidates is idempotent on (food_id, source, external_key)', async () => {
        const { id: foodId } = await foods.createByName({ normalizedName: 'carrot' });
        const candidate = { source: 'usda' as const, externalKey: '170393', name: 'Carrots, raw' };
        await store.persistCandidates({ foodId, candidates: [candidate] });
        await store.persistCandidates({ foodId, candidates: [candidate] });

        expect(await store.getCandidates(foodId)).toHaveLength(1);
    });

    it("isMember validates a pick belongs to this food's set", async () => {
        const { id: foodId } = await foods.createByName({ normalizedName: 'pepper' });
        await store.persistCandidates({
            foodId,
            candidates: [{ source: 'usda', externalKey: '170108', name: 'Peppers, raw' }],
        });
        const [candidate] = await store.getCandidates(foodId);

        expect(await store.isMember({ foodId, candidateId: candidate!.id })).toBe(true);
        expect(await store.isMember({ foodId, candidateId: 'not_a_member' })).toBe(false);
    });

    it('getCandidates excludes a candidate set older than the 30-day TTL (FR-025a)', async () => {
        const { id: foodId } = await foods.createByName({ normalizedName: 'onion' });
        await store.persistCandidates({
            foodId,
            candidates: [{ source: 'usda', externalKey: '170000', name: 'Onions, raw' }],
        });
        await pool.query(`UPDATE food_candidates SET created_at = now() - interval '31 days' WHERE food_id = $1`, [
            foodId,
        ]);

        expect(await store.getCandidates(foodId)).toHaveLength(0);
    });

    it("clear removes a food's candidate set; deleting the parent food cascades the candidates", async () => {
        const { id: foodId } = await foods.createByName({ normalizedName: 'garlic' });
        await store.persistCandidates({
            foodId,
            candidates: [{ source: 'usda', externalKey: '169230', name: 'Garlic, raw' }],
        });

        const cleared = await store.clear(foodId);
        expect(cleared).toBe(1);
        expect(await store.getCandidates(foodId)).toHaveLength(0);

        // Cascade: re-persist, then delete the food → candidates go with it.
        await store.persistCandidates({
            foodId,
            candidates: [{ source: 'usda', externalKey: '169230', name: 'Garlic, raw' }],
        });
        await pool.query(`DELETE FROM food WHERE id = $1`, [foodId]);
        const { rows } = await pool.query<{ count: string }>(
            `SELECT count(*) AS count FROM food_candidates WHERE food_id = $1`,
            [foodId],
        );
        expect(rows[0]?.count).toBe('0');
    });
});
