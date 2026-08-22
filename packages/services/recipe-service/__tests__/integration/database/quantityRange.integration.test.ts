/**
 * U8 — THE MIGRATED QUANTITY COLUMNS, asserted against a real Docker PostgreSQL (R36, R40, R41).
 *
 * ⛔ WHY THIS TIER IS MANDATORY AND A UNIT TEST WOULD BE A LIE. Every claim below is a claim about the
 * DATABASE, and each one is invisible to a mocked DAL:
 *
 *  1. That `0020_quantity_range.sql` actually applied — a unit test cannot observe a migration that did not
 *     run.
 *  2. That `quantity` really lost `NOT NULL`, so an absent quantity persists as `NULL` rather than as a
 *     fabricated `0` (R40).
 *  3. ⚠️ That `CHECK (quantity > 0)` SURVIVED and still ADMITS a NULL. The migration deliberately departs
 *     from the plan's "drop the positive check" wording on the grounds that a Postgres CHECK passes when it
 *     evaluates to NULL. That is a claim about PostgreSQL's three-valued logic, and only PostgreSQL can be
 *     asked. If it were wrong, either every absent quantity would be rejected (the migration is broken) or a
 *     `0` would be accepted (the "absent means zero" confusion is back).
 *  4. That `recipe_ingredients_quantity_coherent` is ENFORCED despite being `NOT VALID` — `NOT VALID` skips
 *     the backfill scan but must still police every INSERT. A test that only read `pg_constraint` would pass
 *     against a constraint Postgres never applies.
 *  5. That a range ROUND-TRIPS through `numeric(10,3)` — the scale, not just the shape.
 *
 * Guarded with `describe.skipIf(!hasDatabaseUrl)` so a machine without the harness skips rather than fails,
 * matching every other integration spec here.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];
const hasDatabaseUrl = Boolean(DATABASE_URL);

/** Ids unique to this suite, so its rows never collide with another integration spec's. */
const OWNER_ID = '01JU8QTY000000000000000OWNER';
const RECIPE_ID = '55555555-5555-4555-8555-000000000801';
const INGREDIENT_ID = '55555555-5555-4555-8555-000000000802';

describe.skipIf(!hasDatabaseUrl)('recipe_ingredients quantity columns (migration 0020)', () => {
    let pool: pg.Pool;

    beforeAll(async () => {
        pool = new pg.Pool({ connectionString: DATABASE_URL });

        await pool.query(
            `INSERT INTO ingredients (id, name, is_user_entered)
             VALUES ($1, 'U8 quantity probe', false)
             ON CONFLICT (id) DO NOTHING`,
            [INGREDIENT_ID],
        );
        await pool.query(
            `INSERT INTO recipes (id, owner_id, title, description, prep_time_minutes, cook_time_minutes,
                                  total_time_minutes, servings, visibility, source_type)
             VALUES ($1, $2, 'U8 quantity probe', '', 1, 1, 2, 1, 'private', 'user_created')
             ON CONFLICT (id) DO NOTHING`,
            [RECIPE_ID, OWNER_ID],
        );
    });

    afterEach(async () => {
        await pool.query('DELETE FROM recipe_ingredients WHERE recipe_id = $1', [RECIPE_ID]);
    });

    afterAll(async () => {
        await pool.query('DELETE FROM recipe_ingredients WHERE recipe_id = $1', [RECIPE_ID]);
        await pool.query('DELETE FROM recipes WHERE id = $1', [RECIPE_ID]);
        await pool.query('DELETE FROM ingredients WHERE id = $1', [INGREDIENT_ID]);
        await pool.end();
    });

    /** Insert one ingredient line with the given bounds, returning the row as Postgres stored it. */
    const insertLine = async (quantity: number | null, quantityHigh: number | null): Promise<pg.QueryResult> =>
        pool.query(
            `INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, quantity_high, unit,
                                             sort_order, ingredient_name, is_user_entered)
             VALUES ($1, $2, $3, $4, 'cup', 0, 'U8 quantity probe', false)
             RETURNING quantity, quantity_high`,
            [RECIPE_ID, INGREDIENT_ID, quantity, quantityHigh],
        );

    it('stores an EXACT quantity with a null upper bound', async () => {
        const { rows } = await insertLine(2, null);

        expect(rows[0]).toEqual({ quantity: '2.000', quantity_high: null });
    });

    // R36 — the half the scalar column could not hold. Asserting the stored SCALE, not just the shape:
    // `numeric(10,3)` is what makes `2.5` survive as `2.500` rather than being truncated.
    it('stores a RANGE across both columns and round-trips it at numeric(10,3) scale', async () => {
        const { rows } = await insertLine(2, 3.5);

        expect(rows[0]).toEqual({ quantity: '2.000', quantity_high: '3.500' });
    });

    // ⛔ R40. Before 0020 this INSERT was a `23502 null value in column "quantity"`, which is why the
    // importer had to DROP the whole line rather than persist what the source actually said.
    it('stores an ABSENT quantity as NULL in BOTH columns — the column lost NOT NULL', async () => {
        const { rows } = await insertLine(null, null);

        expect(rows[0]).toEqual({ quantity: null, quantity_high: null });
    });

    // ⚠️ The kept-check claim, measured. A Postgres CHECK is satisfied when it evaluates to NULL, so
    // `CHECK (quantity > 0)` admits a NULL quantity while still refusing a zero. If this pair ever
    // disagreed, `0` would be back as a second spelling of "absent".
    it('still refuses a ZERO or NEGATIVE quantity, which is what keeps 0 from meaning "absent"', async () => {
        await expect(insertLine(0, null)).rejects.toThrow(/recipe_ingredients_quantity_positive/u);
        await expect(insertLine(-1, null)).rejects.toThrow(/recipe_ingredients_quantity_positive/u);
    });

    it('refuses an upper bound BELOW its lower bound', async () => {
        await expect(insertLine(3, 2)).rejects.toThrow(/recipe_ingredients_quantity_coherent/u);
    });

    // Coincident bounds ARE an exact quantity, and an amount has exactly ONE representation.
    it('refuses an upper bound EQUAL to its lower bound', async () => {
        await expect(insertLine(2, 2)).rejects.toThrow(/recipe_ingredients_quantity_coherent/u);
    });

    it('refuses an upper bound with NO lower bound', async () => {
        await expect(insertLine(null, 3)).rejects.toThrow(/recipe_ingredients_quantity_coherent/u);
    });

    // `NOT VALID` skips the backfill scan; it must NOT skip enforcement. The four rejections above are that
    // proof behaviourally — this pins the declaration so a later "tidy up the constraint" cannot quietly
    // convert it into a plain (scanning) one without a reader noticing.
    it('declares the coherence check as a NOT VALID constraint on recipe_ingredients', async () => {
        const { rows } = await pool.query(
            `SELECT convalidated FROM pg_constraint
             WHERE conname = 'recipe_ingredients_quantity_coherent'
               AND conrelid = 'recipe_ingredients'::regclass`,
        );

        expect(rows).toHaveLength(1);
        expect(rows[0]).toEqual({ convalidated: false });
    });

    it('reports quantity as a NULLABLE numeric(10,3) and quantity_high alongside it', async () => {
        const { rows } = await pool.query(
            `SELECT column_name, is_nullable, data_type, numeric_precision, numeric_scale
             FROM information_schema.columns
             WHERE table_name = 'recipe_ingredients' AND column_name IN ('quantity', 'quantity_high')
             ORDER BY column_name`,
        );

        expect(rows).toEqual([
            {
                column_name: 'quantity',
                is_nullable: 'YES',
                data_type: 'numeric',
                numeric_precision: 10,
                numeric_scale: 3,
            },
            {
                column_name: 'quantity_high',
                is_nullable: 'YES',
                data_type: 'numeric',
                numeric_precision: 10,
                numeric_scale: 3,
            },
        ]);
    });
});
