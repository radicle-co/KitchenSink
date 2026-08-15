/**
 * Integration suite for {@link FoodPortionsDao}, {@link FoodFieldProvenanceDao}, and
 * {@link FoodCategoryDao} (T-108): per-value `source_id` via the composite same-food FK, the
 * `CHECK (gram_weight > 0)` guard (DB-6), and the single-query "which fields came from source X"
 * UNION (FR-028, FR-029, R7, SC-013).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';

import { FoodDao } from '../src/foods/dao/food.dao.js';
import { FoodSourcesDao } from '../src/foods/dao/foodSources.dao.js';
import { NutrientDao } from '../src/foods/dao/nutrient.dao.js';
import { FoodNutrientsDao } from '../src/foods/dao/foodNutrients.dao.js';
import { FoodPortionsDao } from '../src/foods/dao/foodPortions.dao.js';
import { FoodFieldProvenanceDao } from '../src/foods/dao/foodFieldProvenance.dao.js';
import { FoodCategoryDao } from '../src/foods/dao/foodCategory.dao.js';
import { DATABASE_URL, makeDb, makePool, resetSchema, type TestDb } from './support/db.js';

describe.skipIf(!DATABASE_URL)('FoodPortions / FieldProvenance / Category DAOs (integration)', () => {
    let pool: pg.Pool;
    let db: TestDb;
    let foods: FoodDao;
    let sources: FoodSourcesDao;
    let nutrients: NutrientDao;
    let foodNutrients: FoodNutrientsDao;
    let portions: FoodPortionsDao;
    let provenance: FoodFieldProvenanceDao;
    let categories: FoodCategoryDao;

    beforeAll(async () => {
        pool = makePool();
        db = makeDb(pool);
        foods = new FoodDao(db);
        sources = new FoodSourcesDao(db);
        nutrients = new NutrientDao(db);
        foodNutrients = new FoodNutrientsDao(db);
        portions = new FoodPortionsDao(db);
        provenance = new FoodFieldProvenanceDao(db);
        categories = new FoodCategoryDao(db);
    });

    afterAll(async () => {
        await pool?.end();
    });

    beforeEach(async () => {
        await resetSchema(pool);
    });

    it('insertPortion records gram_weight and REJECTS a non-positive gram_weight (CHECK, DB-6)', async () => {
        const { id: foodId } = await foods.createByName({ normalizedName: 'butter' });
        const src = await sources.upsertSource({ foodId, source: 'usda', externalKey: 'B' });

        const portion = await portions.insertPortion({ foodId, label: '1 tbsp', gramWeight: '14.2', sourceId: src.id });
        expect(portion.gramWeight).toBe('14.2');
        expect(await portions.listByFood(foodId)).toHaveLength(1);

        await expect(
            portions.insertPortion({ foodId, label: 'bad', gramWeight: '0', sourceId: src.id }),
        ).rejects.toThrow();
    });

    it('FoodFieldProvenanceDao.record upserts one row per (food_id, field)', async () => {
        const { id: foodId } = await foods.createByName({ normalizedName: 'yogurt' });
        const srcA = await sources.upsertSource({ foodId, source: 'usda', externalKey: 'A' });

        await provenance.record({ foodId, field: 'name', sourceId: srcA.id });
        await provenance.record({ foodId, field: 'name', sourceId: srcA.id });
        expect(await provenance.listByFood(foodId)).toHaveLength(1);
    });

    it('FoodCategoryDao.upsertCategory dedups on name and assign is idempotent', async () => {
        const { id: foodId } = await foods.createByName({ normalizedName: 'cheddar' });
        const cat1 = await categories.upsertCategory('Dairy');
        const cat2 = await categories.upsertCategory('Dairy');
        expect(cat2.id).toBe(cat1.id);

        await categories.assign({ foodId, categoryId: cat1.id });
        await categories.assign({ foodId, categoryId: cat1.id });
        expect(await categories.listByFood(foodId)).toHaveLength(1);
    });

    it('fieldsFromSource returns the provenance set in ONE UNION query (FR-029/SC-013)', async () => {
        const { id: foodId } = await foods.createByName({ normalizedName: 'oatmeal' });
        const src = await sources.upsertSource({ foodId, source: 'usda', externalKey: 'O' });
        const protein = await nutrients.resolveOrCreate({ name: 'Protein', unit: 'g' });

        await provenance.record({ foodId, field: 'name', sourceId: src.id });
        await foodNutrients.upsertValue({ foodId, nutrientId: protein.id, amount: '5', sourceId: src.id });
        await portions.insertPortion({ foodId, label: '1 cup', gramWeight: '80', sourceId: src.id });

        const fields = await provenance.fieldsFromSource(foodId, 'usda');
        const labels = fields.map((f) => f.field).sort();

        expect(labels).toContain(`field:name`);
        expect(labels).toContain(`nutrient:${protein.id}`);
        expect(labels.some((l) => l.startsWith('portion:'))).toBe(true);
        expect(fields).toHaveLength(3);
    });
});
