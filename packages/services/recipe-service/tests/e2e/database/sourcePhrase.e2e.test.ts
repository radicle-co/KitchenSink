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
 * ⚠️ REWRITTEN (plan 002): migration 0051 replaced `recipe_ingredients` with `ingredients` (the recipe LINE),
 * which carries `source_phrase` unchanged. A line binds through a `food_lookups` row
 * (`tests/support/lineChain.ts`) instead of the dead name catalog; the assertions are unchanged.
 *
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { ensureFoodLookup } from '../../support/lineChain.js';
import { recipeDb } from '../../support/roleDb.js';

const roleDb = recipeDb();
const OWNER_ID = '01JU7PHRASE0000000000OWNER0';
const RECIPE_ID = '55555555-5555-4555-8555-000000000941';
/** The binding every probe line points at — a `food_lookups` id since 0051. */
const LOOKUP_ID = '55555555-5555-4555-8555-000000000942';
const PROBE_FOOD_ID = '01JU7PHRASE00000000000FOOD';

describe('ingredients.source_phrase (migrations 0041 → 0051)', () => {
    let pool: pg.Pool;

    beforeAll(async () => {
        pool = new pg.Pool({ connectionString: roleDb.appUrl });

        await pool.query(
            `INSERT INTO recipes (id, owner_id, title, description, prep_time_minutes, cook_time_minutes,
                                  total_time_minutes, servings, visibility, source_type)
             VALUES ($1, $2, 'Source-phrase suite', '', 1, 1, 2, 4, 'private', 'imported_public')
             ON CONFLICT (id) DO NOTHING`,
            [RECIPE_ID, OWNER_ID],
        );
        await ensureFoodLookup(pool, { arm: 'shared', foodId: PROBE_FOOD_ID, id: LOOKUP_ID });
    });

    afterEach(async () => {
        await pool.query(`DELETE FROM ingredients WHERE recipe_id = $1`, [RECIPE_ID]);
    });

    afterAll(async () => {
        // Lines cascade from their recipe; the binding goes last because a line holds it under `RESTRICT`.
        await pool.query(`DELETE FROM recipes WHERE id = $1`, [RECIPE_ID]);
        await pool.query(`DELETE FROM food_lookups WHERE id = $1`, [LOOKUP_ID]);
        await pool.end();
    });

    async function insertLine(sourcePhrase: string | null): Promise<void> {
        await pool.query(
            `INSERT INTO ingredients (recipe_id, food_lookup_id, quantity, unit, sort_order, source_line, source_phrase)
             VALUES ($1, $2, 2, 'cup', 0, '2 cups all-purpose flour, sifted', $3)`,
            [RECIPE_ID, LOOKUP_ID, sourcePhrase],
        );
    }

    it('round-trips the phrase the parse lifted out of the line', async () => {
        await insertLine('all-purpose flour');

        const { rows } = await pool.query(`SELECT source_phrase FROM ingredients WHERE recipe_id = $1`, [RECIPE_ID]);

        expect(rows[0]?.source_phrase).toBe('all-purpose flour');
    });

    it('round-trips NULL — the authored-line and pre-0041 population', async () => {
        await insertLine(null);

        const { rows } = await pool.query(`SELECT source_phrase FROM ingredients WHERE recipe_id = $1`, [RECIPE_ID]);

        expect(rows[0]?.source_phrase).toBeNull();
    });
});
