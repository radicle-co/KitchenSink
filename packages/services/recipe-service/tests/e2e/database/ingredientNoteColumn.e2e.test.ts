/**
 * Migration 0063 — `ingredients.note` and the blank-text CHECKs on `note` and `display_text`, asserted against a real
 * Docker PostgreSQL (owner ruling 2026-11-08).
 *
 * ⛔ WHY THIS TIER IS MANDATORY: a unit test cannot observe a migration that did not apply. What is asserted:
 *
 *  1. `note` exists and round-trips text (a dimension the cook wrote in parentheses, "9 inch").
 *  2. NULL round-trips for both columns: NULL is the ONE spelling of "none" (a blank string would be a second one).
 *  3. A blank or whitespace-only `note` or `display_text` is REFUSED by the database (`ingredients_note_present`,
 *     `ingredients_display_text_present`), because the wire refuses them and a row that cannot be read back is the
 *     write-but-cannot-read break `notes` once had. `btrim` trims SPACES only, like `preparation`'s CHECK; the wire's
 *     schema trims every kind of whitespace, so a tab-only value never reaches the column from a client.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { ensureFoodLookup } from '../../support/lineChain.js';
import { recipeDb } from '../../support/roleDb.js';

const roleDb = recipeDb();
const OWNER_ID = '01JU7NOTECOL000000000OWNER0';
const RECIPE_ID = '55555555-5555-4555-8555-000000000951';
const LOOKUP_ID = '55555555-5555-4555-8555-000000000952';
const PROBE_FOOD_ID = '01JU7NOTECOL00000000000FOOD';

describe('ingredients.note and the blank-text CHECKs (migration 0063)', () => {
    let pool: pg.Pool;

    beforeAll(async () => {
        pool = new pg.Pool({ connectionString: roleDb.appUrl });

        await pool.query(
            `INSERT INTO recipes (id, owner_id, title, description, prep_time_minutes, cook_time_minutes,
                                  total_time_minutes, servings, visibility, source_type)
             VALUES ($1, $2, 'Note column suite', '', 1, 1, 2, 4, 'private', 'imported_public')
             ON CONFLICT (id) DO NOTHING`,
            [RECIPE_ID, OWNER_ID],
        );
        await ensureFoodLookup(pool, { arm: 'shared', foodId: PROBE_FOOD_ID, id: LOOKUP_ID });
    });

    afterEach(async () => {
        await pool.query(`DELETE FROM ingredients WHERE recipe_id = $1`, [RECIPE_ID]);
    });

    afterAll(async () => {
        await pool.query(`DELETE FROM recipes WHERE id = $1`, [RECIPE_ID]);
        await pool.query(`DELETE FROM food_lookups WHERE id = $1`, [LOOKUP_ID]);
        await pool.end();
    });

    async function insertLine(displayText: string | null, note: string | null): Promise<void> {
        await pool.query(
            `INSERT INTO ingredients (recipe_id, food_lookup_id, quantity, unit, sort_order, display_text, note)
             VALUES ($1, $2, 1, '', 0, $3, $4)`,
            [RECIPE_ID, LOOKUP_ID, displayText, note],
        );
    }

    it('round-trips a dimension note and the cook’s words', async () => {
        await insertLine('double-crust pie pastry', '9 inch');

        const { rows } = await pool.query(`SELECT display_text, note FROM ingredients WHERE recipe_id = $1`, [
            RECIPE_ID,
        ]);

        expect(rows[0]).toStrictEqual({ display_text: 'double-crust pie pastry', note: '9 inch' });
    });

    it('round-trips NULL for both: the one spelling of "none"', async () => {
        await insertLine(null, null);

        const { rows } = await pool.query(`SELECT display_text, note FROM ingredients WHERE recipe_id = $1`, [
            RECIPE_ID,
        ]);

        expect(rows[0]).toStrictEqual({ display_text: null, note: null });
    });

    it.each(['', '   '])('refuses a blank note (%j)', async (blank) => {
        await expect(insertLine(null, blank)).rejects.toThrow(/ingredients_note_present/u);
    });

    it.each(['', '   '])('refuses a blank display_text (%j)', async (blank) => {
        await expect(insertLine(blank, null)).rejects.toThrow(/ingredients_display_text_present/u);
    });
});
