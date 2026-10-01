/**
 * Integration suite for {@link FoodSourcesDao} (T-106): crosswalk upsert, external-key / barcode
 * lookup → food id, and the `UNIQUE(food_id, id)` composite target for same-food provenance FKs
 * (FR-008, FR-028, FR-029, FR-032, D-PROVENANCE-FK).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';

import { FoodDao } from '../src/foods/dao/food.dao.js';
import { FoodSourcesDao } from '../src/foods/dao/foodSources.dao.js';
import { makeDb, makePool, type TestDb } from './support/db.js';
import { foodDb, hasTestDatabase } from './support/roleDb.js';

describe.skipIf(!hasTestDatabase)('FoodSourcesDao (integration)', () => {
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
        await foodDb().truncate();
    });

    it("upsertSource keys the crosswalk row on the food's item, satisfying UNIQUE(item_id, id) (D-PROVENANCE-FK)", async () => {
        const { id: foodId } = await foods.createByName({ normalizedName: 'oats' });
        const src = await dao.upsertSource({ foodId, source: 'usda', externalKey: '169705', itemVersion: 'v1' });
        const item = await pool.query<{ item_id: string }>('SELECT item_id FROM food WHERE id = $1', [foodId]);

        expect(src.itemId).toBe(item.rows[0]?.item_id);
        expect(src.externalKey).toBe('169705');
        // A portion keyed on the composite same-item FK (item_id, source_id) must be accepted.
        await expect(
            pool.query(
                `INSERT INTO food_portions (id, item_id, label, gram_weight, source_id)
                 VALUES ('fp_x', $1, '1 cup', '80', $2)`,
                [src.itemId, src.id],
            ),
        ).resolves.toMatchObject({ command: 'INSERT', rowCount: 1 });
    });

    it('lists the backing items of live RESOLVED foods only, never a seed-owned one (refresh exclusion, R14)', async () => {
        const { id: liveId } = await foods.createByName({ normalizedName: 'live oats' });
        await foods.setStatus({ id: liveId, status: 'RESOLVED' });
        await dao.upsertSource({ foodId: liveId, source: 'usda', externalKey: '111', itemVersion: 'v1' });
        await foodDb().asOwner(async (client) => {
            await client.query(
                "INSERT INTO food_item (id, natural_key, owner_kind) VALUES ('item-seed', 'fdc:222', 'root')",
            );
            await client.query(
                `INSERT INTO food (id, item_id, name, normalized_name, status, seed_key)
                 VALUES ('food-seed', 'item-seed', 'seeded oats', 'seeded oats', 'RESOLVED', 'fdc:222')`,
            );
            await client.query(
                "INSERT INTO food_sources (id, item_id, source, external_key) VALUES ('src-seed', 'item-seed', 'usda', '222')",
            );
        });

        expect(await dao.listResolvedBackingItems()).toStrictEqual([
            { foodId: liveId, source: 'usda', externalKey: '111', itemVersion: 'v1' },
        ]);
    });

    it('upsertSource on an existing (source, external_key) updates item_version, keeping the same id', async () => {
        const { id: foodId } = await foods.createByName({ normalizedName: 'rice' });
        const first = await dao.upsertSource({ foodId, source: 'usda', externalKey: '169756', itemVersion: 'v1' });
        const second = await dao.upsertSource({ foodId, source: 'usda', externalKey: '169756', itemVersion: 'v2' });

        expect(second.id).toBe(first.id);
        expect(second.itemVersion).toBe('v2');
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
