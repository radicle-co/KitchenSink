/**
 * U11/R20 — erasure step 13: the dead author's PRIVATE-food catalog rows, against a REAL Postgres.
 *
 * `ingredients.food_owner_id` (0040) marks the shared catalog rows that exist only because one author
 * bound their own private food. On that author's erasure:
 *
 *   - an UNREFERENCED row is DELETED — nothing needs the name any more, so the name goes;
 *   - a row a KEPT recipe still lines against is RETAINED, `food_owner_id` intact — the pseudonymous
 *     ULID beside a food name is the recipes/`owner_id` Recital-26 posture, and the 0040 search filter
 *     hides the row from every living caller regardless;
 *   - another author's private-food row is UNTOUCHED, referenced or not.
 *
 * ⛔ A unit test over the emitted SQL cannot prove the `NOT EXISTS` boundary: whether a row counts as
 * referenced is decided by the database against real `recipe_ingredients` rows, AFTER the same
 * transaction's own recipe deletes — the ordering this suite pins by erasing an owner whose OWN recipe
 * was the only reference.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import pg from 'pg';

import { eraseRecipeRows } from '../../../src/handlers/accountErasureWorker.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];
const canRun = Boolean(DATABASE_URL);

/** The cook whose account is erased. */
const USER_ERASED = '01JU11PFERASE00USERERASED0A';

/** A bystander cook whose recipe keeps one of the erased cook's foods referenced. */
const USER_BYSTANDER = '01JU11PFERASE00USERBYSTAND0';

/** A distinctive name prefix so cleanup reaches exactly this suite's rows. */
const NAME_PREFIX = 'U11 pf-erasure probe';

describe.skipIf(!canRun)('erasure step 13 — private-food catalog rows (U11/R20)', () => {
    let pool: pg.Pool;
    let db: NodePgDatabase<Record<string, never>>;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: DATABASE_URL });
        db = drizzle(pool);
    });

    afterEach(async () => {
        await db.execute(sql`
            DELETE FROM recipe_ingredients WHERE ingredient_id IN
                (SELECT id FROM ingredients WHERE name LIKE ${NAME_PREFIX + '%'})
        `);
        await db.execute(sql`DELETE FROM recipes WHERE owner_id IN (${USER_ERASED}, ${USER_BYSTANDER})`);
        await db.execute(sql`DELETE FROM ingredients WHERE name LIKE ${NAME_PREFIX + '%'}`);
        await db.execute(sql`DELETE FROM account_erasure_jobs WHERE owner_id IN (${USER_ERASED}, ${USER_BYSTANDER})`);
    });

    afterAll(async () => {
        await pool.end();
    });

    /** Insert one private-food catalog row and return its id. */
    async function insertPrivateFoodRow(name: string, ownerId: string): Promise<string> {
        const result = await db.execute<{ id: string }>(sql`
            INSERT INTO ingredients (name, is_user_entered, search_vector, food_id, food_resolution_status,
                                     food_owner_id)
            VALUES (${name}, false, to_tsvector('english', ${name}),
                    ${'01JU11PF' + Math.random().toString(36).slice(2, 10).toUpperCase().padEnd(18, '0')},
                    'RESOLVED', ${ownerId})
            RETURNING id
        `);
        const id = result.rows[0]?.id;

        if (id === undefined) {
            throw new Error('test setup: the ingredient insert returned no id');
        }

        return id;
    }

    /** Insert a recipe for `ownerId` lining `ingredientId`, and return the recipe id. */
    async function insertReferencingRecipe(ownerId: string, ingredientId: string): Promise<string> {
        const recipe = await db.execute<{ id: string }>(sql`
            INSERT INTO recipes (owner_id, title, description, servings, prep_time_minutes, cook_time_minutes,
                                 total_time_minutes, visibility, status)
            VALUES (${ownerId}, ${NAME_PREFIX + ' recipe'}, 'probe', 2, 5, 5, 10, 'private', 'published')
            RETURNING id
        `);
        const recipeId = recipe.rows[0]?.id;

        if (recipeId === undefined) {
            throw new Error('test setup: the recipe insert returned no id');
        }

        await db.execute(sql`
            INSERT INTO recipe_ingredients (recipe_id, ingredient_id, ingredient_name, quantity, unit, sort_order)
            VALUES (${recipeId}, ${ingredientId}, ${NAME_PREFIX}, 1, 'cup', 0)
        `);

        return recipeId;
    }

    /** The surviving ingredient row, or undefined. */
    async function ingredientById(id: string): Promise<{ id: string; food_owner_id: string | null } | undefined> {
        const { rows } = await db.execute<{ id: string; food_owner_id: string | null }>(sql`
            SELECT id, food_owner_id FROM ingredients WHERE id = ${id}
        `);

        return rows[0];
    }

    it('DELETES an unreferenced private-food row — including one only the erased recipes referenced', async () => {
        const unreferenced = await insertPrivateFoodRow(`${NAME_PREFIX} unreferenced`, USER_ERASED);
        // Referenced ONLY by the erased cook's own recipe — the recipe delete runs first in the same
        // transaction, so by step 13 this row is unreferenced and must go too.
        const ownRecipeOnly = await insertPrivateFoodRow(`${NAME_PREFIX} own-recipe-only`, USER_ERASED);
        await insertReferencingRecipe(USER_ERASED, ownRecipeOnly);

        await eraseRecipeRows(db, USER_ERASED, []);

        expect(await ingredientById(unreferenced)).toBeUndefined();
        expect(await ingredientById(ownRecipeOnly)).toBeUndefined();
    });

    it('RETAINS a row a surviving recipe still lines against, food_owner_id intact (pseudonymous)', async () => {
        const referenced = await insertPrivateFoodRow(`${NAME_PREFIX} referenced`, USER_ERASED);
        await insertReferencingRecipe(USER_BYSTANDER, referenced);

        await eraseRecipeRows(db, USER_ERASED, []);

        const survivor = await ingredientById(referenced);

        expect(survivor).toBeDefined();
        // Retained WITH the ULID — the counter/reference posture, never a scrub. The 0040 search filter
        // is what keeps the row invisible; a dead author never searches again.
        expect(survivor?.food_owner_id).toBe(USER_ERASED);
    });

    it("leaves ANOTHER author's private-food row untouched, referenced or not", async () => {
        const bystanders = await insertPrivateFoodRow(`${NAME_PREFIX} bystander`, USER_BYSTANDER);

        await eraseRecipeRows(db, USER_ERASED, []);

        expect((await ingredientById(bystanders))?.food_owner_id).toBe(USER_BYSTANDER);
    });
});
