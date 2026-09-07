/**
 * Migration 0041 — the `source_phrase` column, asserted against a real Docker PostgreSQL.
 *
 * ⛔ WHY THIS TIER IS MANDATORY: a unit test cannot observe a migration that did not apply, and this
 * column is the capture point for the memo tier's key grain (owner ruling 2026-08-31, U15 report "Owner
 * rulings" §3) — without it every verification agreement is banked nowhere. What is asserted:
 *
 *  1. The column exists and round-trips text (0041 applied).
 *  2. `NULL` round-trips — the authored-line and pre-0041 population, which the producer must project as
 *     "no phrase; write no memo" rather than an empty string.
 *
 * The migration's OTHER statement — `DELETE FROM ingredient_resolution_memos` — is not asserted here: a
 * fresh IT database has no pre-0041 memos to delete, so the assertion would be vacuous. Its correctness is
 * carried by the migration being a plain unconditional DELETE.
 *
 * Guarded with `describe.skipIf(!hasDatabaseUrl)`, matching every other integration spec here.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];
const hasDatabaseUrl = Boolean(DATABASE_URL);

const OWNER_ID = '01JU7PHRASE0000000000OWNER0';
const RECIPE_ID = '55555555-5555-4555-8555-000000000941';
const INGREDIENT_ID = '55555555-5555-4555-8555-000000000942';

describe.skipIf(!hasDatabaseUrl)('recipe_ingredients.source_phrase (migration 0041)', () => {
    let pool: pg.Pool;

    beforeAll(async () => {
        pool = new pg.Pool({ connectionString: DATABASE_URL });

        await pool.query(
            `INSERT INTO recipes (id, owner_id, title, description, prep_time_minutes, cook_time_minutes,
                                  total_time_minutes, servings, visibility, source_type)
             VALUES ($1, $2, 'Source-phrase suite', '', 1, 1, 2, 4, 'private', 'imported_public')
             ON CONFLICT (id) DO NOTHING`,
            [RECIPE_ID, OWNER_ID],
        );
        await pool.query(
            `INSERT INTO ingredients (id, name) VALUES ($1, 'all-purpose flour') ON CONFLICT (id) DO NOTHING`,
            [INGREDIENT_ID],
        );
    });

    afterEach(async () => {
        await pool.query(`DELETE FROM recipe_ingredients WHERE recipe_id = $1`, [RECIPE_ID]);
    });

    afterAll(async () => {
        await pool.query(`DELETE FROM recipes WHERE id = $1`, [RECIPE_ID]);
        await pool.query(`DELETE FROM ingredients WHERE id = $1`, [INGREDIENT_ID]);
        await pool.end();
    });

    async function insertLine(sourcePhrase: string | null): Promise<void> {
        await pool.query(
            `INSERT INTO recipe_ingredients
                 (recipe_id, ingredient_id, ingredient_name, quantity, unit, sort_order, is_user_entered,
                  source_line, source_phrase)
             VALUES ($1, $2, 'all-purpose flour', 2, 'cup', 0, false, '2 cups all-purpose flour, sifted', $3)`,
            [RECIPE_ID, INGREDIENT_ID, sourcePhrase],
        );
    }

    it('round-trips the phrase the parse lifted out of the line', async () => {
        await insertLine('all-purpose flour');

        const { rows } = await pool.query(`SELECT source_phrase FROM recipe_ingredients WHERE recipe_id = $1`, [
            RECIPE_ID,
        ]);

        expect(rows[0]?.source_phrase).toBe('all-purpose flour');
    });

    it('round-trips NULL — the authored-line and pre-0041 population', async () => {
        await insertLine(null);

        const { rows } = await pool.query(`SELECT source_phrase FROM recipe_ingredients WHERE recipe_id = $1`, [
            RECIPE_ID,
        ]);

        expect(rows[0]?.source_phrase).toBeNull();
    });
});
