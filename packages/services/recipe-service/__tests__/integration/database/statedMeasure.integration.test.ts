/**
 * U7/U11 — THE STATED (pre-restatement) MEASURE COLUMNS, asserted against a real Docker PostgreSQL.
 *
 * ⛔ WHY THIS TIER IS MANDATORY. Every claim below is a claim about the DATABASE, and a mocked DAL can
 * observe none of them:
 *
 *  1. That `0027_ingredient_stated_measure.sql` actually applied. A unit test cannot see a migration that
 *     did not run, and the columns it adds are what stop the verification gate being shown a number the
 *     source never printed.
 *  2. That `recipe_ingredients_stated_measure_coherent` is ENFORCED despite being `NOT VALID` — `NOT VALID`
 *     skips the backfill scan but must still police every INSERT. A test that only read `pg_constraint`
 *     would pass against a constraint Postgres never applies.
 *  3. That the pair is ALL-OR-NOTHING. A stated quantity with no stated unit is a restatement that cannot
 *     say what it restated FROM, which is exactly the state R35's marker exists to make impossible.
 *  4. That a stated measure REQUIRES a restated one. `quantity IS NULL` means the source stated no amount,
 *     and an absent quantity is never restated — so a stated measure beside a NULL `quantity` is a row no
 *     code path can produce and no reader has a meaning for.
 *  5. That the stated bounds round-trip at `numeric(10,3)` scale, the same scale the restated pair uses,
 *     so the two halves of one conversion are stored at one precision.
 *
 * ⚠️ Deliberately NOT asserted here: that the stated pair and the restated pair have the same RANGE-NESS.
 * Two stated bounds a ten-thousandth apart round to one value at `numeric(10,3)`, so a stated range can
 * legitimately restate to an exact quantity. The right response to that is to REFUSE the conversion at the
 * point of production (`convertHistoricalUnit`, which returns `null` and leaves the line its own words),
 * not a CHECK that turns a legitimate save into a 500. The database polices the pair's own coherence; the
 * tool polices the relationship between the pair and its restatement.
 *
 * Guarded with `describe.skipIf(!hasDatabaseUrl)` so a machine without the harness skips rather than fails,
 * matching every other integration spec here.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];
const hasDatabaseUrl = Boolean(DATABASE_URL);

/** Ids unique to this suite, so its rows never collide with another integration spec's. */
const OWNER_ID = '01JU7STATED00000000000OWNER';
const RECIPE_ID = '55555555-5555-4555-8555-000000000901';
const INGREDIENT_ID = '55555555-5555-4555-8555-000000000902';

/** One line's stated half, as the columns spell it. */
interface StatedColumns {
    readonly quantity: number | null;
    readonly quantityHigh: number | null;
    readonly unit: string | null;
}

describe.skipIf(!hasDatabaseUrl)('recipe_ingredients stated-measure columns (migration 0027)', () => {
    let pool: pg.Pool;

    beforeAll(async () => {
        pool = new pg.Pool({ connectionString: DATABASE_URL });

        await pool.query(
            `INSERT INTO ingredients (id, name, is_user_entered)
             VALUES ($1, 'U7 stated-measure probe', false)
             ON CONFLICT (id) DO NOTHING`,
            [INGREDIENT_ID],
        );
        await pool.query(
            `INSERT INTO recipes (id, owner_id, title, description, prep_time_minutes, cook_time_minutes,
                                  total_time_minutes, servings, visibility, source_type)
             VALUES ($1, $2, 'U7 stated-measure probe', '', 1, 1, 2, 1, 'private', 'imported_public')
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

    /**
     * Insert one ingredient line carrying a restated pair and a stated pair.
     *
     * @param restated - The `quantity` / `quantity_high` the catalog weighs.
     * @param stated - The `stated_*` columns, i.e. what the source printed.
     * @returns The stored row.
     */
    const insertLine = async (
        restated: { quantity: number | null; quantityHigh: number | null },
        stated: StatedColumns,
    ): Promise<pg.QueryResult> =>
        pool.query(
            `INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, quantity_high, unit,
                                             stated_quantity, stated_quantity_high, stated_unit,
                                             sort_order, ingredient_name, is_user_entered)
             VALUES ($1, $2, $3, $4, 'cup', $5, $6, $7, 0, 'U7 stated-measure probe', false)
             RETURNING stated_quantity, stated_quantity_high, stated_unit`,
            [
                RECIPE_ID,
                INGREDIENT_ID,
                restated.quantity,
                restated.quantityHigh,
                stated.quantity,
                stated.quantityHigh,
                stated.unit,
            ],
        );

    // The plan's own headline case: `one gill of milk` is restated to `0.5 cup`, and the gill survives
    // beside it as structured data rather than only as prose.
    it('stores an EXACT stated measure beside its restatement, at numeric(10,3) scale', async () => {
        const { rows } = await insertLine(
            { quantity: 0.5, quantityHigh: null },
            { quantity: 1, quantityHigh: null, unit: 'gill' },
        );

        expect(rows[0]).toEqual({ stated_quantity: '1.000', stated_quantity_high: null, stated_unit: 'gill' });
    });

    it('stores a stated RANGE across both stated columns', async () => {
        const { rows } = await insertLine(
            { quantity: 0.5, quantityHigh: 1 },
            { quantity: 1, quantityHigh: 2, unit: 'gill' },
        );

        expect(rows[0]).toEqual({ stated_quantity: '1.000', stated_quantity_high: '2.000', stated_unit: 'gill' });
    });

    // ⛔ The dominant case, and the reason every column is nullable: an AUTHORED line, and every line
    // imported before this migration shipped, has no stated-versus-restated distinction at all.
    it('admits a line with no stated measure at all', async () => {
        const { rows } = await insertLine(
            { quantity: 2, quantityHigh: null },
            { quantity: null, quantityHigh: null, unit: null },
        );

        expect(rows[0]).toEqual({ stated_quantity: null, stated_quantity_high: null, stated_unit: null });
    });

    // ⛔ HALF a restatement is worse than none: a converted amount that cannot name what it converted FROM
    // is indistinguishable from a directly-stated one, which is the disclosure R35 exists to force.
    it('REFUSES a stated quantity with no stated unit', async () => {
        await expect(
            insertLine({ quantity: 0.5, quantityHigh: null }, { quantity: 1, quantityHigh: null, unit: null }),
        ).rejects.toThrow(/recipe_ingredients_stated_measure_coherent/);
    });

    it('REFUSES a stated unit with no stated quantity', async () => {
        await expect(
            insertLine({ quantity: 0.5, quantityHigh: null }, { quantity: null, quantityHigh: null, unit: 'gill' }),
        ).rejects.toThrow(/recipe_ingredients_stated_measure_coherent/);
    });

    // ⛔ `''` is the `unit` column's spelling of "unitless", and a restatement is never FROM nothing. Left
    // admissible, the blank would be a second spelling of "no stated measure" — the exact two-representations
    // defect `recipeIngredientUnitSchema` and the `quantity`/`0` rule were both written to remove.
    it('REFUSES a blank stated unit', async () => {
        await expect(
            insertLine({ quantity: 0.5, quantityHigh: null }, { quantity: 1, quantityHigh: null, unit: '' }),
        ).rejects.toThrow(/recipe_ingredients_stated_measure_coherent/);
    });

    it('REFUSES a non-positive stated quantity', async () => {
        await expect(
            insertLine({ quantity: 0.5, quantityHigh: null }, { quantity: 0, quantityHigh: null, unit: 'gill' }),
        ).rejects.toThrow(/recipe_ingredients_stated_measure_coherent/);
    });

    // Coincident bounds ARE an exact quantity — the same rule `statedQuantity` applies in the domain, so the
    // stated pair cannot spell a range that is really one value.
    it('REFUSES a stated upper bound at or below its lower', async () => {
        await expect(
            insertLine({ quantity: 0.5, quantityHigh: 1 }, { quantity: 2, quantityHigh: 2, unit: 'gill' }),
        ).rejects.toThrow(/recipe_ingredients_stated_measure_coherent/);
    });

    it('REFUSES a stated upper bound with no stated lower bound', async () => {
        await expect(
            insertLine({ quantity: 0.5, quantityHigh: 1 }, { quantity: null, quantityHigh: 2, unit: 'gill' }),
        ).rejects.toThrow(/recipe_ingredients_stated_measure_coherent/);
    });

    // ⛔ An ABSENT quantity is never restated: there is no number to convert, and inventing one is R40's
    // forbidden fabrication. So a stated measure beside a NULL `quantity` is a row nothing can produce.
    it('REFUSES a stated measure on a line whose restated quantity is absent', async () => {
        await expect(
            insertLine({ quantity: null, quantityHigh: null }, { quantity: 1, quantityHigh: null, unit: 'gill' }),
        ).rejects.toThrow(/recipe_ingredients_stated_measure_coherent/);
    });
});
