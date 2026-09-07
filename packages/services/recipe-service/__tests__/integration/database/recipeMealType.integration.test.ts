/**
 * U34 — THE `recipes.meal_type` COLUMN AND ITS CHECK, asserted against a real Docker PostgreSQL.
 *
 * ⛔ WHY THIS TIER IS MANDATORY, and what a mocked DAL structurally cannot see:
 *
 *  1. That `0032_recipe_meal_type.sql` actually applied. A unit test cannot observe a migration that did not
 *     run — a create/read round trip against a mock agrees with itself while the column does not exist.
 *  2. That `recipes_meal_type_check` is ENFORCED despite being `NOT VALID`. `NOT VALID` skips the backfill
 *     scan but must still police every INSERT and UPDATE, and this is the ONLY place that difference is
 *     observable. This is the load-bearing assertion of the whole unit: the closed vocabulary is a claim
 *     about the DATABASE, not about a zod schema a caller could bypass by any other write path.
 *  3. That `NULL` passes the check. `NULL IN (...)` evaluates to NULL, not false, and a CHECK admits NULL —
 *     which is exactly what makes "the author did not say" representable and what makes the constraint safe
 *     to add `NOT VALID` against a table where every existing row has no meal type at all.
 *  4. That the neighbouring classification columns stay UNCONSTRAINED. `tags` and `dietary_flags` are free
 *     text by ruling; a regression that "tidied" them into a domain would be invisible to any unit test and
 *     would start rejecting cooks' own words. Asserted in the negative, deliberately.
 *  5. That the stored value round-trips byte-for-byte and case-sensitively — `'Dinner'` is refused, not
 *     folded, so the facet cannot acquire two spellings of one value.
 *
 * ⚠️ Deliberately NOT asserted here: any relationship between `meal_type` and `tags`. The mockup wrote its
 * Dietary chips into the SAME array as its Categories, which is the state bug U34 exists to avoid; the two
 * are separate axes and nothing couples them.
 *
 * Guarded with `describe.skipIf(!hasDatabaseUrl)` so a machine without the harness skips rather than fails,
 * matching every other integration spec here.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { RECIPE_MEAL_TYPES } from '@kitchensink/recipe-core';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];
const hasDatabaseUrl = Boolean(DATABASE_URL);

/** Ids unique to this suite, so its rows never collide with another integration spec's. */
const OWNER_ID = '01JU7MEALTYPE00000000OWNER0';
const RECIPE_ID = '66666666-6666-4666-8666-000000000931';

describe.skipIf(!hasDatabaseUrl)('recipes.meal_type (migration 0032)', () => {
    let pool: pg.Pool;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: DATABASE_URL });
    });

    afterEach(async () => {
        await pool.query('DELETE FROM recipes WHERE id = $1', [RECIPE_ID]);
    });

    afterAll(async () => {
        await pool.query('DELETE FROM recipes WHERE id = $1', [RECIPE_ID]);
        await pool.end();
    });

    /**
     * Insert one recipe carrying `mealType`.
     *
     * @param mealType - The value to store, or `null` for "the author did not say".
     * @returns The stored row's `meal_type`.
     * @sideEffect Writes a `recipes` row.
     */
    const insertRecipe = async (mealType: string | null): Promise<pg.QueryResult> =>
        pool.query(
            `INSERT INTO recipes (id, owner_id, title, description, prep_time_minutes, cook_time_minutes,
                                  total_time_minutes, servings, visibility, source_type, meal_type)
             VALUES ($1, $2, 'U34 meal-type probe', '', 1, 1, 2, 1, 'private', 'user_created', $3)
             RETURNING meal_type`,
            [RECIPE_ID, OWNER_ID, mealType],
        );

    it('stores every member of the vocabulary', async () => {
        for (const value of RECIPE_MEAL_TYPES) {
            const { rows } = await insertRecipe(value);

            expect(rows[0]).toEqual({ meal_type: value });

            await pool.query('DELETE FROM recipes WHERE id = $1', [RECIPE_ID]);
        }
    });

    // The dominant case, and the reason the column is nullable: EVERY row written before this migration has
    // no meal type at all, which is what makes the `NOT VALID` check safe to add without a validating scan.
    it('admits a recipe that states none — which is every pre-existing row', async () => {
        const { rows } = await insertRecipe(null);

        expect(rows[0]).toEqual({ meal_type: null });
    });

    // ⛔ THE assertion of this unit. Everything else would still pass if the CHECK had been written and never
    // applied; only a real INSERT can tell that the database is the one enforcing the vocabulary.
    it('REFUSES a value outside the vocabulary at the DATABASE, not merely at the schema', async () => {
        await expect(insertRecipe('supper')).rejects.toThrow(/recipes_meal_type_check/u);
    });

    it('REFUSES a differently-cased spelling, so the facet cannot acquire two values for one meal', async () => {
        await expect(insertRecipe('Dinner')).rejects.toThrow(/recipes_meal_type_check/u);
    });

    it('REFUSES an empty string, so absence has exactly one spelling — NULL', async () => {
        await expect(insertRecipe('')).rejects.toThrow(/recipes_meal_type_check/u);
    });

    it('polices an UPDATE too, not only the INSERT the NOT VALID check was added beside', async () => {
        await insertRecipe('dinner');

        await expect(
            pool.query('UPDATE recipes SET meal_type = $2 WHERE id = $1', [RECIPE_ID, 'elevenses']),
        ).rejects.toThrow(/recipes_meal_type_check/u);

        const { rows } = await pool.query('SELECT meal_type FROM recipes WHERE id = $1', [RECIPE_ID]);

        expect(rows[0]).toEqual({ meal_type: 'dinner' });
    });

    it('lets an UPDATE CLEAR a stated meal type back to NULL', async () => {
        await insertRecipe('dinner');
        await pool.query('UPDATE recipes SET meal_type = NULL WHERE id = $1', [RECIPE_ID]);

        const { rows } = await pool.query('SELECT meal_type FROM recipes WHERE id = $1', [RECIPE_ID]);

        expect(rows[0]).toEqual({ meal_type: null });
    });

    // ⛔ In the NEGATIVE, deliberately. The sibling classification columns must stay free text: a change that
    // "tidied" them into a domain would start rejecting a cook's own words, and no unit test could see it.
    it('leaves tags and dietary_flags UNCONSTRAINED — meal type is the only closed axis', async () => {
        const { rows } = await pool.query(
            `INSERT INTO recipes (id, owner_id, title, description, prep_time_minutes, cook_time_minutes,
                                  total_time_minutes, servings, visibility, source_type, meal_type, tags,
                                  dietary_flags)
             VALUES ($1, $2, 'U34 free-text probe', '', 1, 1, 2, 1, 'private', 'user_created', 'dinner',
                     ARRAY['a tag nobody curated'], ARRAY['low-FODMAP'])
             RETURNING tags, dietary_flags`,
            [RECIPE_ID, OWNER_ID],
        );

        expect(rows[0]).toEqual({ tags: ['a tag nobody curated'], dietary_flags: ['low-FODMAP'] });
    });

    it('names the column exactly `meal_type`, and types it as nullable text', async () => {
        const { rows } = await pool.query(
            `SELECT data_type, is_nullable, column_default
             FROM information_schema.columns
             WHERE table_name = 'recipes' AND column_name = 'meal_type'`,
        );

        expect(rows).toHaveLength(1);
        // NO default: a default would silently classify every recipe ever written, which is the guess the
        // whole "not stated is a real state" ruling exists to refuse.
        expect(rows[0]).toEqual({ data_type: 'text', is_nullable: 'YES', column_default: null });
    });
});
