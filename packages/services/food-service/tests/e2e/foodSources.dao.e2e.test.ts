/**
 * Integration suite for {@link FoodSourcesDao} (T-106): the crosswalk record, external-key / barcode
 * lookup → food id, and the `UNIQUE(food_id, id)` composite target for same-food provenance FKs
 * (FR-008, FR-028, FR-029, FR-032, D-PROVENANCE-FK).
 *
 * `recordSource` replaced `upsertSource` (FOOD-SERVICE-6): the upsert's `ON CONFLICT DO UPDATE` wrote to whichever
 * row held the key, so a merge naming an item a seeded root holds wrote to the seed's row and the ownership trigger
 * refused it. Its two cases here were rewritten to prove the new contract, and the held cases were added.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';

import { FoodDao } from '../../src/foods/dao/food.dao.js';
import { FoodSourcesDao, type SourceRecord } from '../../src/foods/dao/foodSources.dao.js';
import type { FoodSourceRow } from '../../src/db/schema/index.js';
import { makeSeededRoot } from '../__fixtures__/catalogFood.js';
import { makeDb, makePool, type TestDb } from '../support/db.js';
import { foodDb } from '../support/roleDb.js';

/**
 * The row a record wrote, or a loud failure: the case expected the food to take the item.
 *
 * @param record - The record.
 * @returns Its row.
 */
function rowOf(record: SourceRecord): FoodSourceRow {
    if (record.kind !== 'recorded') {
        throw new Error('expected the food to record the item, and another food holds it');
    }

    return record.row;
}

describe('FoodSourcesDao (integration)', () => {
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

    it("recordSource claims a free key on the food's item, satisfying UNIQUE(item_id, id) (D-PROVENANCE-FK)", async () => {
        const { id: foodId } = await foods.createByName({ normalizedName: 'oats' });
        const src = rowOf(await dao.recordSource({ foodId, source: 'usda', externalKey: '169705', itemVersion: 'v1' }));
        const item = await pool.query<{ item_id: string }>('SELECT item_id FROM food WHERE id = $1', [foodId]);

        expect(src.itemId).toBe(item.rows[0]?.item_id);
        expect(src.externalKey).toBe('169705');
        expect(src.itemVersion).toBe('v1');
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
        rowOf(await dao.recordSource({ foodId: liveId, source: 'usda', externalKey: '111', itemVersion: 'v1' }));
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

    it("recordSource on the food's OWN row advances item_version, keeping the same id (the change-refresh re-pull)", async () => {
        const { id: foodId } = await foods.createByName({ normalizedName: 'rice' });
        const first = rowOf(
            await dao.recordSource({ foodId, source: 'usda', externalKey: '169756', itemVersion: 'v1' }),
        );
        const second = rowOf(
            await dao.recordSource({ foodId, source: 'usda', externalKey: '169756', itemVersion: 'v2' }),
        );

        expect(second.id).toBe(first.id);
        expect(second.itemVersion).toBe('v2');
    });

    it('⛔ recordSource never writes over a seed-owned row: it answers held, and the row is as it was', async () => {
        await makeSeededRoot(foodDb(), { name: 'Broccoli', sourceKey: '747447' });
        const { id: foodId } = await foods.createByName({ normalizedName: 'broccoli florets' });
        const read = async () =>
            foodDb().asOwner(
                async (client) =>
                    (
                        await client.query(
                            "SELECT id, item_id, item_version, fetch_state, fetched_at FROM food_sources WHERE external_key = '747447'",
                        )
                    ).rows,
            );
        const before = await read();

        expect(await dao.recordSource({ foodId, source: 'usda', externalKey: '747447', itemVersion: 'v9' })).toEqual({
            kind: 'held',
        });
        expect(await read()).toEqual(before);
    });

    it("⛔ recordSource never writes over another live food's row either", async () => {
        const { id: holderId } = await foods.createByName({ normalizedName: 'broccoli, raw' });
        const held = rowOf(
            await dao.recordSource({ foodId: holderId, source: 'usda', externalKey: '1001', itemVersion: 'v1' }),
        );
        const { id: foodId } = await foods.createByName({ normalizedName: 'broccoli florets' });

        expect(await dao.recordSource({ foodId, source: 'usda', externalKey: '1001', itemVersion: 'v2' })).toEqual({
            kind: 'held',
        });
        expect(
            (await pool.query('SELECT item_id, item_version FROM food_sources WHERE id = $1', [held.id])).rows,
        ).toEqual([{ item_id: held.itemId, item_version: 'v1' }]);
    });

    it('claimSource records the item version and fetch state it is given, and answers undefined for a held key', async () => {
        const { id: foodId } = await foods.createByName({ normalizedName: 'barley' });
        const claimed = await dao.claimSource({ foodId, source: 'usda', externalKey: '2002', itemVersion: 'v3' });
        const { id: otherId } = await foods.createByName({ normalizedName: 'pearl barley' });

        expect(claimed).toMatchObject({ externalKey: '2002', itemVersion: 'v3', fetchState: 'fetched' });
        expect(await dao.claimSource({ foodId: otherId, source: 'usda', externalKey: '2002' })).toBeUndefined();
    });

    // Rewritten for plan 002 S3 (property 2): the crosswalk now answers RESOLVED catalog rows only, so a food still
    // PENDING is not a hit. The full matrix (authored, retired, withdrawn) is `tests/e2e/catalogSearchPrivacy.e2e.test.ts`.
    it('findCatalogFoodByBarcode resolves a RESOLVED catalog food via the food.barcode index, and not a PENDING one', async () => {
        const { id: foodId } = await foods.createByName({ normalizedName: 'cereal bar' });
        await pool.query(`UPDATE food SET barcode = '0123456789012', name = 'cereal bar' WHERE id = $1`, [foodId]);

        expect(await dao.findCatalogFoodByBarcode('0123456789012')).toBeUndefined();

        await pool.query(`UPDATE food SET status = 'RESOLVED' WHERE id = $1`, [foodId]);

        expect(await dao.findCatalogFoodByBarcode('0123456789012')).toStrictEqual({ id: foodId, name: 'cereal bar' });
        expect(await dao.findCatalogFoodByBarcode('9999999999999')).toBeUndefined();
    });

    it('findSourceId returns the crosswalk row id for a (food_id, source)', async () => {
        const { id: foodId } = await foods.createByName({ normalizedName: 'beans' });
        const src = rowOf(await dao.recordSource({ foodId, source: 'usda', externalKey: '173735' }));

        expect(await dao.findSourceId(foodId, 'usda')).toBe(src.id);
    });
});
