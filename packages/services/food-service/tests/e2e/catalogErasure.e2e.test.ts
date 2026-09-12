/**
 * LOCAL e2e: erasing an author on the item-keyed catalog (curated catalog plan U4, KTD-6, KTD-12, ADR-0029).
 *
 * An authored food owns an item, and its portions and nutrition hang off the item and the root. Erasure and the
 * test-principal purge run as `food_app`, the role the deployed service holds, so the ownership trigger sees exactly
 * the session it sees in a stage: the author's items and everything under them go, and no seed-owned row and no other
 * author's food is touched.
 */
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { FOOD_TABLE_POLICY } from '../../src/db/schema/catalog.js';
import { makeDb, type TestDb } from '../support/db.js';
import { eraseFoodRows } from '../../src/foods/eraseFoodRows.js';
import { purgeTestPrincipalFoods } from '../../src/foods/purgeTestPrincipalFoods.js';
import { foodDb } from '../support/roleDb.js';
import {
    insertHeader,
    insertItem,
    insertNutrient,
    insertRoot,
    makeCatalogWorld,
    newId,
    type CatalogWorld,
} from './__fixtures__/catalogWorld.js';

const AUTHOR = 'user-erased-author';
const OTHER_AUTHOR = 'user-other-author';

/** One authored food with an uncited value and an uncited portion, written as the owner. */
async function authoredFood(
    author: string,
    visibility: 'private' | 'promoted' = 'private',
): Promise<{ food: string; item: string }> {
    return foodDb().asOwner(async (client) => {
        const item = await insertItem(client, null, 'root');
        const food = await insertRoot(client, item, { seedKey: null, userId: author });

        await client.query('UPDATE food SET visibility = $2 WHERE id = $1', [food, visibility]);

        const header = await insertHeader(client, { foodId: food });
        const nutrient = await insertNutrient(client);

        await client.query(
            "INSERT INTO food_nutrition_value (nutrition_id, nutrient_id, amount, basis) VALUES ($1, $2, 12, 'per_100g')",
            [header, nutrient],
        );
        await client.query("INSERT INTO food_portions (id, item_id, label, gram_weight) VALUES ($1, $2, 'piece', 30)", [
            newId('portion'),
            item,
        ]);

        return { food, item };
    });
}

/** Every catalog row that hangs off one food and its item, counted as the owner. */
async function rowsUnder(food: string, item: string): Promise<Record<string, number>> {
    return foodDb().asOwner(async (client) => {
        const counted = await client.query<Record<string, number>>(
            `SELECT (SELECT count(*) FROM food WHERE id = $1)::int AS food,
                    (SELECT count(*) FROM food_item WHERE id = $2)::int AS item,
                    (SELECT count(*) FROM food_portions WHERE item_id = $2)::int AS portions,
                    (SELECT count(*) FROM food_nutrition WHERE food_id = $1)::int AS headers,
                    (SELECT count(*) FROM food_nutrition_value v JOIN food_nutrition h ON h.id = v.nutrition_id
                      WHERE h.food_id = $1)::int AS "values"`,
            [food, item],
        );

        return counted.rows[0] ?? {};
    });
}

/**
 * Every row of every catalog table, so "nothing else changed" is one comparison. The tables are the registry's own
 * catalog set, so a table added to the catalog is counted here the day it is registered.
 */
async function catalogCensus(): Promise<Record<string, number>> {
    return foodDb().asOwner(async (client) => {
        const counted = await client.query<{ table: string; n: number }>(
            `SELECT t AS table, (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM %I', t), false, true, '')))[1]::text::int AS n
               FROM unnest($1::text[]) t`,
            [[...FOOD_TABLE_POLICY.catalog]],
        );

        return Object.fromEntries(counted.rows.map((row) => [row.table, row.n]));
    });
}

const PRESENT = { food: 1, item: 1, portions: 1, headers: 1, values: 1 };
const GONE = { food: 0, item: 0, portions: 0, headers: 0, values: 0 };

describe('erasing an author on the item-keyed catalog', () => {
    let pool: pg.Pool;
    let db: TestDb;
    let seed: CatalogWorld;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: foodDb().appUrl });
        db = makeDb(pool);
    });

    beforeEach(async () => {
        await foodDb().truncate();
        seed = await foodDb().asOwner((client) => makeCatalogWorld(client, 'seed'));
    });

    afterAll(async () => {
        await pool?.end();
        await foodDb().truncate();
    });

    it("removes the author's foods, their items, every per-item row and their nutrition", async () => {
        const first = await authoredFood(AUTHOR);
        const second = await authoredFood(AUTHOR);
        const other = await authoredFood(OTHER_AUTHOR);
        const seedBefore = await catalogCensus();

        const outcome = await eraseFoodRows(db, AUTHOR);

        expect(outcome.deletedAuthoredFoods).toBe(2);
        expect(await rowsUnder(first.food, first.item)).toStrictEqual(GONE);
        expect(await rowsUnder(second.food, second.item)).toStrictEqual(GONE);
        expect(await rowsUnder(other.food, other.item)).toStrictEqual(PRESENT);

        const seedAfter = await catalogCensus();
        const removed = Object.fromEntries(
            Object.entries(seedBefore).map(([table, count]) => [table, count - (seedAfter[table] ?? 0)]),
        );

        // Exactly the two foods' own rows went: an item, a root, a header, a value and a portion each.
        expect(removed).toStrictEqual({
            food_item: 2,
            food: 2,
            food_variant: 0,
            food_variant_part: 0,
            food_sources: 0,
            food_field_provenance: 0,
            food_category_assignment: 0,
            food_nutrition: 2,
            food_nutrition_citation: 0,
            food_nutrition_value: 2,
            food_portions: 2,
            food_forward: 0,
        });
        expect(await rowsUnder(seed.root, seed.item)).toStrictEqual(PRESENT);
    });

    it("removes the erased cook's hourly source budget, and keeps another cook's (migration 0020)", async () => {
        for (const requester of [AUTHOR, OTHER_AUTHOR]) {
            await pool.query(
                `INSERT INTO requester_source_budget (requester_id, spent, window_ends_at) VALUES ($1, 3, now() + interval '1 hour')`,
                [requester],
            );
        }

        await eraseFoodRows(db, AUTHOR);

        const left = await pool.query<{ requester_id: string }>(
            'SELECT requester_id FROM requester_source_budget ORDER BY requester_id',
        );

        expect(left.rows.map((row) => row.requester_id)).toStrictEqual([OTHER_AUTHOR]);
    });

    it('keeps a referenced food with its item, and removes the rest', async () => {
        const kept = await authoredFood(AUTHOR);
        const gone = await authoredFood(AUTHOR);

        const outcome = await eraseFoodRows(db, AUTHOR, [kept.food]);

        expect(outcome.deletedAuthoredFoods).toBe(1);
        expect(await rowsUnder(kept.food, kept.item)).toStrictEqual(PRESENT);
        expect(await rowsUnder(gone.food, gone.item)).toStrictEqual(GONE);
    });

    it("purges a test principal's private foods with their items, and keeps a promoted one", async () => {
        const privateFood = await authoredFood(AUTHOR);
        const promoted = await authoredFood(AUTHOR, 'promoted');
        const other = await authoredFood(OTHER_AUTHOR);

        const outcome = await purgeTestPrincipalFoods(db, AUTHOR);

        expect(outcome).toStrictEqual({ deletedAuthoredFoods: 1, retainedPromotedFoods: 1 });
        expect(await rowsUnder(privateFood.food, privateFood.item)).toStrictEqual(GONE);
        expect(await rowsUnder(promoted.food, promoted.item)).toStrictEqual(PRESENT);
        expect(await rowsUnder(other.food, other.item)).toStrictEqual(PRESENT);
        expect(await rowsUnder(seed.root, seed.item)).toStrictEqual(PRESENT);
    });
});
