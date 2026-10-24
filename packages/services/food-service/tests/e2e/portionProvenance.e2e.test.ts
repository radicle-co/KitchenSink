/**
 * LOCAL e2e: who stands behind a portion, decided once in the golden read (curated catalog plan U4, KTD-19).
 *
 * A portion names its crosswalk row, cites a dataset, or names neither, which means its food's author wrote it. The
 * "uncited means authored" trigger only admits the third under an authored food, so the read has three answers, and a
 * cited portion must report its citation's source rather than fall through to the author.
 */
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { FoodDao } from '../../src/foods/dao/food.dao.js';
import { makeDb } from '../support/db.js';
import { foodDb } from '../support/roleDb.js';
import { makeCatalogWorld, newId, nextNumber } from './__fixtures__/catalogWorld.js';

describe('a portion’s provenance in the golden read', () => {
    let pool: pg.Pool;
    let foods: FoodDao;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: foodDb().appUrl });
        foods = new FoodDao(makeDb(pool));
    });

    beforeEach(async () => {
        await foodDb().truncate();
    });

    afterAll(async () => {
        await pool?.end();
        await foodDb().truncate();
    });

    it('reports a crosswalk row’s source, a citation’s source, and no source for an authored portion', async () => {
        const seeded = await foodDb().asOwner(async (client) => {
            const world = await makeCatalogWorld(client, 'seed');
            const citation = newId('citation');

            await client.query(
                `INSERT INTO food_nutrition_citation (id, nutrition_id, dataset, external_key, match)
                 VALUES ($1, $2, 'ciqual', $3, 'exact')`,
                [citation, world.nutrition, String(nextNumber())],
            );
            await client.query(
                "INSERT INTO food_portions (id, item_id, label, gram_weight, citation_id) VALUES ($1, $2, 'slice', 30, $3)",
                [newId('portion'), world.item, citation],
            );

            return world;
        });
        const authored = await foodDb().asOwner(async (client) => {
            const world = await makeCatalogWorld(client, 'authored');

            await client.query(
                "INSERT INTO food_portions (id, item_id, label, gram_weight) VALUES ($1, $2, 'scoop', 12)",
                [newId('portion'), world.item],
            );

            return world;
        });

        const seededPortions = (await foods.readGoldenRecord(seeded.root))?.portions ?? [];
        const authoredPortions = (await foods.readGoldenRecord(authored.root))?.portions ?? [];

        expect(seededPortions.map((portion) => [portion.label, portion.source]).sort()).toStrictEqual([
            ['cup', 'usda'],
            ['slice', 'ciqual'],
        ]);
        expect(authoredPortions.map((portion) => [portion.label, portion.source]).sort()).toStrictEqual([
            ['cup', 'usda'],
            ['scoop', null],
        ]);
    });
});
