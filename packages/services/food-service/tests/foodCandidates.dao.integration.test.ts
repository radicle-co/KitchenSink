/**
 * Integration suite for {@link CandidateStore} (T-111 DAO): persist a food's candidate set,
 * list it (TTL-filtered), validate a pick is a member, and clear it on resolve. Anchored on
 * `created_at` for the 30-day candidate-set TTL (FR-025a, FR-RES-1, FR-RES-2, FR-MRG-5).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type pg from 'pg';

import { FoodDao } from '../src/foods/dao/food.dao.js';
import { CandidateStore } from '../src/foods/dao/foodCandidates.dao.js';
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

    /**
     * T-150 — the candidate-set TTL is CONFIGURED (`FOOD_UNRESOLVED_TTL_DAYS`), and both halves of FR-025a
     * must read the same number. The sweep half already did; the READ half was a hardcoded 30 days, so
     * under the `FOOD_UNRESOLVED_TTL_DAYS=60` the infra stack can stamp into the change-refresh task, a set
     * aged 31–59 days survived the sweep yet was invisible to `GET /{id}/candidates` — an UNRESOLVED food
     * with candidates in the table and none on the wire, i.e. no way for the user to disambiguate it.
     *
     * A fresh `CandidateStore` is built inside each case because the TTL is resolved at construction.
     */
    describe('the configured candidate-set TTL (FR-025a)', () => {
        /** Persist one candidate for a fresh food and age the set by `days`. */
        async function agedSet(name: string, days: number): Promise<string> {
            const { id: foodId } = await foods.createByName({ normalizedName: name });
            await store.persistCandidates({
                foodId,
                candidates: [{ source: 'usda', externalKey: '170379', name: 'Broccoli, raw' }],
            });
            await pool.query(
                `UPDATE food_candidates SET created_at = now() - make_interval(days => $2) WHERE food_id = $1`,
                [foodId, days],
            );

            return foodId;
        }

        afterEach(() => {
            vi.unstubAllEnvs();
        });

        it('keeps a 40-day-old set VISIBLE under a 60-day TTL — the sweep has not reached it', async () => {
            const foodId = await agedSet('broccoli-ttl-visible', 40);

            vi.stubEnv('FOOD_UNRESOLVED_TTL_DAYS', '60');

            expect(await new CandidateStore(db).getCandidates(foodId)).toHaveLength(1);
        });

        it('hides the same set under the default TTL, and the sweep agrees with the read', async () => {
            const foodId = await agedSet('broccoli-ttl-hidden', 40);

            vi.stubEnv('FOOD_UNRESOLVED_TTL_DAYS', undefined);
            const defaulted = new CandidateStore(db);

            expect(await defaulted.getCandidates(foodId)).toHaveLength(0);
            // The two halves of FR-025a now agree: what the read hides, the sweep deletes.
            expect(await defaulted.clearExpired()).toBe(1);
        });

        it('hides a set the configured TTL has expired even when it is younger than 30 days', async () => {
            const foodId = await agedSet('broccoli-ttl-short', 10);

            vi.stubEnv('FOOD_UNRESOLVED_TTL_DAYS', '5');

            expect(await new CandidateStore(db).getCandidates(foodId)).toHaveLength(0);
        });
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
