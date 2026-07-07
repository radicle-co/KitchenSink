/**
 * Integration suite for {@link FoodSourcesDao} (T-106): crosswalk upsert, external-key / barcode
 * lookup → food id, and the `UNIQUE(food_id, id)` composite target for same-food provenance FKs
 * (FR-008, FR-028, FR-029, FR-032, D-PROVENANCE-FK).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';

import { FoodDao } from '../src/foods/dao/food.dao.js';
import { FoodSourcesDao } from '../src/foods/dao/food-sources.dao.js';
import { DATABASE_URL, makeDb, makePool, resetSchema, type TestDb } from './support/db.js';

describe.skipIf(!DATABASE_URL)('FoodSourcesDao (integration)', () => {
    let pool: pg.Pool;
    let db: TestDb;
    let foods: FoodDao;
    let dao: FoodSourcesDao;

    beforeAll(async () => {
        pool = makePool();
        db = makeDb(pool);
        foods = new FoodDao(db);
        dao = new FoodSourcesDao(db);
    });

    afterAll(async () => {
        await pool?.end();
    });

    beforeEach(async () => {
        await resetSchema(pool);
    });

    it('upsertSource inserts a crosswalk row that satisfies UNIQUE(food_id, id) (D-PROVENANCE-FK)', async () => {
        const { id: foodId } = await foods.createByName({ normalizedName: 'oats' });
        const src = await dao.upsertSource({ foodId, source: 'usda', externalKey: '169705', itemVersion: 'v1' });

        expect(src.foodId).toBe(foodId);
        expect(src.externalKey).toBe('169705');
        // A value row keyed on the composite same-food FK (food_id, source_id) must be accepted.
        await pool.query(`INSERT INTO nutrient (id, name, unit) VALUES ('nut_x', 'Fiber', 'g')`);
        await expect(
            pool.query(
                `INSERT INTO food_nutrients (id, food_id, nutrient_id, amount, source_id)
                 VALUES ('fn_x', $1, 'nut_x', '10', $2)`,
                [foodId, src.id],
            ),
        ).resolves.toBeDefined();
    });

    it('upsertSource on an existing (source, external_key) updates item_version, keeping the same id', async () => {
        const { id: foodId } = await foods.createByName({ normalizedName: 'rice' });
        const first = await dao.upsertSource({ foodId, source: 'usda', externalKey: '169756', itemVersion: 'v1' });
        const second = await dao.upsertSource({ foodId, source: 'usda', externalKey: '169756', itemVersion: 'v2' });

        expect(second.id).toBe(first.id);
        expect(second.itemVersion).toBe('v2');
    });

    it('findFoodIdByExternalKey resolves via UNIQUE(source, external_key)', async () => {
        const { id: foodId } = await foods.createByName({ normalizedName: 'lentils' });
        await dao.upsertSource({ foodId, source: 'usda', externalKey: '172421' });

        expect(await dao.findFoodIdByExternalKey('usda', '172421')).toBe(foodId);
        expect(await dao.findFoodIdByExternalKey('usda', 'nope')).toBeUndefined();
    });

    it('findFoodIdByBarcode resolves via the food.barcode index', async () => {
        const { id: foodId } = await foods.createByName({ normalizedName: 'cereal bar' });
        await pool.query(`UPDATE food SET barcode = '0123456789012' WHERE id = $1`, [foodId]);

        expect(await dao.findFoodIdByBarcode('0123456789012')).toBe(foodId);
        expect(await dao.findFoodIdByBarcode('9999999999999')).toBeUndefined();
    });

    it('findSourceId returns the crosswalk row id for a (food_id, source)', async () => {
        const { id: foodId } = await foods.createByName({ normalizedName: 'beans' });
        const src = await dao.upsertSource({ foodId, source: 'usda', externalKey: '173735' });

        expect(await dao.findSourceId(foodId, 'usda')).toBe(src.id);
    });
});
