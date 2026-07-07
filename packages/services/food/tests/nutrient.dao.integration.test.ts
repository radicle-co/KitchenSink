/**
 * Integration suite for {@link NutrientDao} + {@link FoodNutrientsDao} (T-107): dictionary dedup
 * (DB-5), the golden-winner overwrite on `UNIQUE(food_id, nutrient_id)`, the composite same-food
 * provenance FK, and the `CHECK (amount >= 0)` value guard (DB-6) (FR-028, FR-MRG-3, SC-008).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';

import { FoodDao } from '../src/foods/dao/food.dao.js';
import { FoodSourcesDao } from '../src/foods/dao/food-sources.dao.js';
import { NutrientDao } from '../src/foods/dao/nutrient.dao.js';
import { FoodNutrientsDao } from '../src/foods/dao/food-nutrients.dao.js';
import { DATABASE_URL, makeDb, makePool, resetSchema, type TestDb } from './support/db.js';

describe.skipIf(!DATABASE_URL)('NutrientDao + FoodNutrientsDao (integration)', () => {
    let pool: pg.Pool;
    let db: TestDb;
    let foods: FoodDao;
    let sources: FoodSourcesDao;
    let nutrients: NutrientDao;
    let foodNutrients: FoodNutrientsDao;

    beforeAll(async () => {
        pool = makePool();
        db = makeDb(pool);
        foods = new FoodDao(db);
        sources = new FoodSourcesDao(db);
        nutrients = new NutrientDao(db);
        foodNutrients = new FoodNutrientsDao(db);
    });

    afterAll(async () => {
        await pool?.end();
    });

    beforeEach(async () => {
        await resetSchema(pool);
    });

    describe('NutrientDao.resolveOrCreate — dictionary dedup (DB-5)', () => {
        it('two source nutrients for the same (name, unit) collapse to one nutrient_id — even when one external_code is NULL', async () => {
            const withCode = await nutrients.resolveOrCreate({ name: 'Protein', unit: 'g', externalCode: '203' });
            const withoutCode = await nutrients.resolveOrCreate({ name: 'Protein', unit: 'g', externalCode: null });

            expect(withoutCode.id).toBe(withCode.id);
            const { rows } = await pool.query<{ count: string }>(
                `SELECT count(*) AS count FROM nutrient WHERE name = 'Protein' AND unit = 'g'`,
            );
            expect(rows[0]?.count).toBe('1');
        });

        it('resolves by external_code first, and backfills a previously-NULL code', async () => {
            const first = await nutrients.resolveOrCreate({ name: 'Total fat', unit: 'g', externalCode: null });
            const second = await nutrients.resolveOrCreate({ name: 'Total fat', unit: 'g', externalCode: '204' });

            expect(second.id).toBe(first.id);
            expect(second.externalCode).toBe('204');
        });

        it('distinct (name, unit) pairs get distinct nutrient_ids', async () => {
            const protein = await nutrients.resolveOrCreate({ name: 'Protein', unit: 'g' });
            const energy = await nutrients.resolveOrCreate({ name: 'Energy', unit: 'kcal' });
            expect(protein.id).not.toBe(energy.id);
        });
    });

    describe('FoodNutrientsDao.upsertValue — golden winner (FR-MRG-3, DB-6)', () => {
        it('stores amount as numeric (no float drift) and overwrites the golden winner + source_id on a second value', async () => {
            const { id: foodId } = await foods.createByName({ normalizedName: 'almonds' });
            const srcA = await sources.upsertSource({ foodId, source: 'usda', externalKey: 'A' });
            const protein = await nutrients.resolveOrCreate({ name: 'Protein', unit: 'g', externalCode: '203' });

            const v1 = await foodNutrients.upsertValue({
                foodId,
                nutrientId: protein.id,
                amount: '21.15',
                sourceId: srcA.id,
            });
            expect(v1.amount).toBe('21.15');
            expect(v1.basis).toBe('per_100g');

            // A second value for the SAME (food_id, nutrient_id) overwrites the winner and updates source_id.
            const srcB = await sources.upsertSource({ foodId, source: 'usda', externalKey: 'B' });
            const v2 = await foodNutrients.upsertValue({
                foodId,
                nutrientId: protein.id,
                amount: '20.00',
                sourceId: srcB.id,
            });
            expect(v2.amount).toBe('20.00');
            expect(v2.sourceId).toBe(srcB.id);

            const list = await foodNutrients.listByFood(foodId);
            expect(list).toHaveLength(1);
        });

        it('REJECTS a source_id from another food (composite same-food FK)', async () => {
            const { id: foodA } = await foods.createByName({ normalizedName: 'cashews' });
            const { id: foodB } = await foods.createByName({ normalizedName: 'walnuts' });
            const srcB = await sources.upsertSource({ foodId: foodB, source: 'usda', externalKey: 'B2' });
            const protein = await nutrients.resolveOrCreate({ name: 'Protein', unit: 'g' });

            await expect(
                foodNutrients.upsertValue({ foodId: foodA, nutrientId: protein.id, amount: '5', sourceId: srcB.id }),
            ).rejects.toThrow();
        });

        it('REJECTS a negative amount (CHECK amount >= 0, DB-6)', async () => {
            const { id: foodId } = await foods.createByName({ normalizedName: 'pecans' });
            const src = await sources.upsertSource({ foodId, source: 'usda', externalKey: 'P' });
            const fat = await nutrients.resolveOrCreate({ name: 'Total fat', unit: 'g' });

            await expect(
                foodNutrients.upsertValue({ foodId, nutrientId: fat.id, amount: '-1', sourceId: src.id }),
            ).rejects.toThrow();
        });
    });
});
