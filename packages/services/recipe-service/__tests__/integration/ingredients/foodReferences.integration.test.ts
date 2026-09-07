/**
 * U18 — the cross-service reference check's recipe half against the REAL app + database.
 *
 * Two claims only this tier can prove: the grouped join counts LIVE recipes only (a soft-deleted
 * recipe's reference dies with it), and the authenticated route enumerates the CALLER's own recipe ids
 * while a stranger's referencing recipe stays a count.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { asPrincipal, bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from '../../../tests/e2e/harness.js';

const OWNER = '01JFOODREFSOWNER000000000A';
const STRANGER = '01JFOODREFSSTRANGER000000A';
const FOOD_ID = 'food-refs-test-0001';
const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];

describe.skipIf(!hasDatabaseUrl)('food references (integration, U18)', () => {
    let booted: BootedRecipeApp;
    let baseUrl: string;
    let pool: pg.Pool;

    beforeAll(async () => {
        booted = await bootRecipeApp({ devAuthUserId: OWNER });
        baseUrl = booted.baseUrl;
        pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
    });

    afterAll(async () => {
        await pool.query(`DELETE FROM recipes WHERE owner_id IN ($1, $2)`, [OWNER, STRANGER]);
        await pool.query(`DELETE FROM ingredients WHERE food_id = $1`, [FOOD_ID]);
        await pool.end();
        await booted.close();
    });

    /** Seed a recipe referencing FOOD_ID via THE catalog-backed ingredient row (one per food — the
     *  `idx_ingredients_food_id` unique means every referencing recipe shares it, exactly as in production). */
    async function seedReferencingRecipe(ownerId: string, deleted: boolean): Promise<string> {
        const ingredient = await pool.query(
            `INSERT INTO ingredients (name, food_id, food_resolution_status)
             VALUES ('Ref Food', $1, 'RESOLVED')
             ON CONFLICT (food_id) WHERE food_id IS NOT NULL DO UPDATE SET name = EXCLUDED.name
             RETURNING id`,
            [FOOD_ID],
        );
        const recipe = await pool.query(
            `INSERT INTO recipes (owner_id, title, prep_time_minutes, cook_time_minutes, total_time_minutes,
                                  servings, deleted_at)
             VALUES ($1, 'Referencing dish', 5, 5, 10, 2, CASE WHEN $2 THEN now() ELSE NULL END)
             RETURNING id`,
            [ownerId, deleted],
        );
        await pool.query(
            `INSERT INTO recipe_ingredients (recipe_id, ingredient_id, ingredient_name, quantity, unit, sort_order)
             VALUES ($1, $2, 'Ref Food', 1, 'cup', 0)`,
            [recipe.rows[0].id, ingredient.rows[0].id],
        );

        return recipe.rows[0].id as string;
    }

    it('counts every LIVE referencing recipe, enumerates only the caller`s own, and ignores soft-deleted ones', async () => {
        const own = await seedReferencingRecipe(OWNER, false);
        await seedReferencingRecipe(STRANGER, false);
        await seedReferencingRecipe(OWNER, true); // soft-deleted — must not count

        const res = await fetch(`${baseUrl}/api/v1/ingredients/food-references/${FOOD_ID}`);

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ total: 2, ownRecipeIds: [own] });

        // The stranger sees the same total and THEIR own id — never the other user's.
        await asPrincipal(STRANGER, async () => {
            const theirs = (await (await fetch(`${baseUrl}/api/v1/ingredients/food-references/${FOOD_ID}`)).json()) as {
                total: number;
                ownRecipeIds: string[];
            };

            expect(theirs.total).toBe(2);
            expect(theirs.ownRecipeIds).not.toContain(own);
            expect(theirs.ownRecipeIds).toHaveLength(1);
        });
    });
});
