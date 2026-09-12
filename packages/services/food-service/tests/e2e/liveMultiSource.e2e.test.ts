/**
 * LOCAL e2e: a live food that blends two USDA items, on the item-keyed catalog (curated catalog plan U4, KTD-6,
 * KTD-19, R50).
 *
 * The live write path runs as `food_app` against a migrated database: it writes one crosswalk row per contributing
 * item on the food's own item, one nutrition header, one citation per item with the dataset the item's source
 * stated, and each value citing the item that supplied it. The ownership trigger and the "uncited means authored"
 * assertion both watch every one of those writes, so this suite proves the live path satisfies them.
 */
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { FoodDao } from '../../src/foods/dao/food.dao.js';
import { GoldenRecordMergeEngine } from '../../src/foods/merge/mergeEngine.js';
import { MergeAndPersistService } from '../../src/foods/merge/mergeAndPersist.service.js';
import { makeMergeCandidate } from '../../src/foods/merge/__fixtures__/merge.fixtures.js';
import { SourceAdapterRegistry } from '../../src/sources/SourceAdapterRegistry.js';
import { makeDb, type TestDb } from '../support/db.js';
import { foodDb } from '../support/roleDb.js';

describe('a live food blending two USDA items', () => {
    let pool: pg.Pool;
    let db: TestDb;
    let foods: FoodDao;
    let merge: MergeAndPersistService;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: foodDb().appUrl });
        db = makeDb(pool);
        foods = new FoodDao(db);
        merge = new MergeAndPersistService(db, new GoldenRecordMergeEngine(new SourceAdapterRegistry()));
    });

    beforeEach(async () => {
        await foodDb().truncate();
    });

    afterAll(async () => {
        await pool?.end();
        await foodDb().truncate();
    });

    /** Two picks of one food: a Foundation item with protein and a portion, an FNDDS item with energy and a portion. */
    const picks = [
        makeMergeCandidate('usda', {
            externalKey: '1001',
            dataset: 'usdaSrFoundation',
            name: 'Broccoli, raw',
            itemVersion: 'v1',
            nutrients: [{ code: null, name: 'Protein', unit: 'g', amount: '2.82', basis: 'per_100g' }],
            portions: [{ label: '1 cup chopped', gramWeight: '91' }],
        }),
        makeMergeCandidate('usda', {
            externalKey: '2002',
            dataset: 'usdaFndds',
            name: 'Broccoli, raw',
            itemVersion: 'v7',
            nutrients: [{ code: null, name: 'Energy', unit: 'kcal', amount: '34', basis: 'per_100g' }],
            portions: [{ label: '1 spear', gramWeight: '31' }],
        }),
    ];

    it('persists two source rows on the food’s own item, and reads back whole', async () => {
        const { id: foodId } = await foods.createByName({ normalizedName: 'broccoli, raw' });

        await merge.resolveFromPicks({ foodId, picks });

        const record = await foods.readGoldenRecord(foodId);

        expect(record?.status).toBe('RESOLVED');
        expect(record?.sources.map((source) => [source.externalKey, source.itemVersion]).sort()).toStrictEqual([
            ['1001', 'v1'],
            ['2002', 'v7'],
        ]);
        expect(
            record?.nutrients.map((value) => [value.name, value.amount, value.source, value.infoodsTag]).sort(),
        ).toStrictEqual([
            ['Energy', '34', 'usda', 'ENERC_KCAL'],
            ['Protein', '2.82', 'usda', 'PROCNT'],
        ]);
        expect(record?.portions.map((portion) => portion.label).sort()).toStrictEqual(['1 cup chopped', '1 spear']);

        const items = await pool.query<{ n: number }>(
            `SELECT count(DISTINCT s.item_id)::int AS n FROM food_sources s JOIN food f ON f.item_id = s.item_id
              WHERE f.id = $1`,
            [foodId],
        );

        expect(items.rows).toStrictEqual([{ n: 1 }]);
    });

    it('cites each item once, with its own dataset, and each value cites the item that supplied it', async () => {
        const { id: foodId } = await foods.createByName({ normalizedName: 'broccoli, raw' });

        await merge.resolveFromPicks({ foodId, picks });

        const cited = await pool.query<{ nutrient: string; dataset: string; external_key: string }>(
            `SELECT n.name AS nutrient, c.dataset, c.external_key
               FROM food_nutrition h
               JOIN food_nutrition_value v ON v.nutrition_id = h.id
               JOIN nutrient n ON n.id = v.nutrient_id
               JOIN food_nutrition_citation c ON c.nutrition_id = v.nutrition_id AND c.id = v.citation_id
              WHERE h.food_id = $1
              ORDER BY n.name`,
            [foodId],
        );
        const citations = await pool.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM food_nutrition_citation c JOIN food_nutrition h ON h.id = c.nutrition_id
              WHERE h.food_id = $1`,
            [foodId],
        );

        expect(cited.rows).toStrictEqual([
            { nutrient: 'Energy', dataset: 'usdaFndds', external_key: '2002' },
            { nutrient: 'Protein', dataset: 'usdaSrFoundation', external_key: '1001' },
        ]);
        expect(citations.rows).toStrictEqual([{ n: 2 }]);
    });

    it('re-merges a changed item onto the same header and citations, never a second one', async () => {
        const { id: foodId } = await foods.createByName({ normalizedName: 'broccoli, raw' });

        await merge.resolveFromPicks({ foodId, picks });
        await merge.mergeChangedSources({
            foodId,
            changed: [
                makeMergeCandidate('usda', {
                    externalKey: '1001',
                    dataset: 'usdaSrFoundation',
                    name: 'Broccoli, raw',
                    itemVersion: 'v2',
                    nutrients: [{ code: null, name: 'Protein', unit: 'g', amount: '2.90', basis: 'per_100g' }],
                    portions: [{ label: '1 cup chopped', gramWeight: '91' }],
                }),
            ],
        });

        const counts = await pool.query<{ headers: number; citations: number; values: number }>(
            `SELECT (SELECT count(*) FROM food_nutrition WHERE food_id = $1)::int AS headers,
                    (SELECT count(*) FROM food_nutrition_citation c JOIN food_nutrition h ON h.id = c.nutrition_id
                      WHERE h.food_id = $1)::int AS citations,
                    (SELECT count(*) FROM food_nutrient_view WHERE food_id = $1)::int AS "values"`,
            [foodId],
        );
        const record = await foods.readGoldenRecord(foodId);

        expect(counts.rows).toStrictEqual([{ headers: 1, citations: 2, values: 2 }]);
        expect(record?.nutrients.find((value) => value.name === 'Protein')?.amount).toBe('2.90');
    });
});
