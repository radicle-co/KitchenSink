/**
 * ADV-5 — ingredient catalog dedup is race-proof (integration, real Docker Postgres).
 *
 * `createFreeform` / `createFoodBacked` dedup with a read-then-insert. Two concurrent calls for the same
 * key both miss the SELECT and both INSERT, which — before the fix — produced duplicate catalog rows.
 * The fix is a DB-enforced partial UNIQUE index (migration 0006) plus `INSERT … ON CONFLICT DO NOTHING`
 * and a re-select, so the loser of the race returns the winner's row. Only a real database exercises the
 * concurrency + the unique constraint, so it is proven here.
 *
 * Uses distinctive keys so it never collides with the seeded baseline catalog, and cleans only its own
 * rows. Guarded with `describe.skipIf(!hasDatabaseUrl)` so it is a no-op when the harness is not up.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';

import { FoodResolutionStatus } from '@kitchensink/recipe-core';
import { createRecipeDrizzle, type RecipeDrizzle } from '../../../src/database/client.js';
import { IngredientsDal } from '../../../src/ingredients/dal/ingredients.dal.js';
import { makeCanonicalName } from '../../../src/ingredients/__fixtures__/ingredients.fixtures.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];
const hasDatabaseUrl = Boolean(DATABASE_URL);

const RACE_FOOD_ID = 'race-food-adv5-0001';
const RACE_NAME = 'RaceSpice Adv5';
const CONCURRENCY = 8;

describe.skipIf(!hasDatabaseUrl)('IngredientsDal dedup is race-proof (integration)', () => {
    let pool: pg.Pool;
    let db: RecipeDrizzle;
    let dal: IngredientsDal;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: DATABASE_URL });
        db = createRecipeDrizzle(pool);
        dal = new IngredientsDal(db);
    });

    afterAll(async () => {
        await pool.end();
    });

    beforeEach(async () => {
        // Remove only this spec's rows so the seeded baseline catalog is left intact for other specs.
        await pool.query(`DELETE FROM ingredients WHERE food_id = $1 OR lower(name) = lower($2)`, [
            RACE_FOOD_ID,
            RACE_NAME,
        ]);
    });

    /** Count catalog rows matching a food_id. */
    async function countByFoodId(foodId: string): Promise<number> {
        const { rows } = await pool.query<{ n: string }>(
            `SELECT count(*)::int AS n FROM ingredients WHERE food_id = $1`,
            [foodId],
        );

        return Number(rows[0]!.n);
    }

    /** Count freeform catalog rows matching a case-insensitive name. */
    async function countFreeformByName(name: string): Promise<number> {
        const { rows } = await pool.query<{ n: string }>(
            `SELECT count(*)::int AS n FROM ingredients WHERE is_user_entered = true AND lower(name) = lower($1)`,
            [name],
        );

        return Number(rows[0]!.n);
    }

    it('createFoodBacked: N concurrent inserts of the same food_id yield exactly ONE row', async () => {
        const results = await Promise.all(
            Array.from({ length: CONCURRENCY }, () =>
                dal.createFoodBacked({
                    name: makeCanonicalName('Race Flour'),
                    foodId: RACE_FOOD_ID,
                    foodResolutionStatus: FoodResolutionStatus.PENDING,
                }),
            ),
        );

        // The DB holds a single row, and every concurrent caller resolved to that same winner id.
        expect(await countByFoodId(RACE_FOOD_ID)).toBe(1);
        const ids = new Set(results.map((ingredient) => ingredient.id));
        expect(ids.size).toBe(1);
        expect(results.every((ingredient) => ingredient.foodId === RACE_FOOD_ID)).toBe(true);
    });

    it('createFreeform: N concurrent inserts of the same (case-insensitive) name yield exactly ONE row', async () => {
        // Mix exact and case-variant spellings — the unique index is on lower(name).
        const spellings = Array.from({ length: CONCURRENCY }, (_unused, index) =>
            index % 2 === 0 ? RACE_NAME : RACE_NAME.toUpperCase(),
        );

        const results = await Promise.all(spellings.map((name) => dal.createFreeform(makeCanonicalName(name))));

        expect(await countFreeformByName(RACE_NAME)).toBe(1);
        const ids = new Set(results.map((ingredient) => ingredient.id));
        expect(ids.size).toBe(1);
    });

    it('the DB rejects a duplicate food_id at the unique index (deterministic constraint proof)', async () => {
        await pool.query(
            `INSERT INTO ingredients (name, food_id, food_resolution_status, is_user_entered, search_vector)
             VALUES ('First', $1, 'PENDING', false, to_tsvector('english', 'First'))`,
            [RACE_FOOD_ID],
        );

        await expect(
            pool.query(
                `INSERT INTO ingredients (name, food_id, food_resolution_status, is_user_entered, search_vector)
                 VALUES ('Second', $1, 'PENDING', false, to_tsvector('english', 'Second'))`,
                [RACE_FOOD_ID],
            ),
        ).rejects.toMatchObject({ code: '23505' }); // unique_violation
    });
});
