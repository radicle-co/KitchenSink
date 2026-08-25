/**
 * U26/U27 — THE PREPARATION AND GROUP-LABEL COLUMNS, asserted against a real Docker PostgreSQL.
 *
 * ⛔ WHY THIS TIER IS MANDATORY. Every claim below is a claim about the DATABASE, and a mocked DAL can
 * observe none of them:
 *
 *  1. That `0030_ingredient_preparation_and_group.sql` actually applied. A unit test cannot see a migration
 *     that did not run — and a create/read round trip against a mock would agree with itself while the
 *     column that is supposed to hold the value does not exist.
 *  2. That `recipe_ingredients_preparation_present` and `recipe_ingredients_group_label_present` are
 *     ENFORCED despite being `NOT VALID`. `NOT VALID` skips the backfill scan but must still police every
 *     INSERT and UPDATE; a test that only read `pg_constraint` would pass against a constraint Postgres
 *     never applies.
 *  3. That `NULL` is the ONE spelling of absent. `''` and whitespace-only are refused, so "no preparation"
 *     and "ungrouped" cannot each acquire a second representation — the same defect the `unit`/`''` rule and
 *     the `quantity`/`0` rule were each written to remove. For a group label it is worse than redundant:
 *     `'Dry '` would fold into a SECOND section under a heading visually identical to `'Dry'`.
 *  4. That the two columns are INDEPENDENT. A preparation with no group and a group with no preparation are
 *     both ordinary lines; nothing pairs them.
 *  5. That a pre-existing row — every line written before this migration — satisfies both checks trivially,
 *     which is the property that makes `NOT VALID` safe to add without a table scan (ADR-0022, expand-first).
 *  6. That the value survives at full length and byte-for-byte, including non-ASCII: a group label is free
 *     text by owner ruling (2026-08-24), not an enum, so a `text` column with no collation surprises is what
 *     the wire promises.
 *
 * ⚠️ Deliberately NOT asserted here: any relationship between `preparation` and `display_text`. They are
 * different facts with different producers (U26's ruling), and a CHECK coupling them would refuse the
 * ordinary imported line, which legitimately carries a `display_text` clause and no preparation.
 *
 * Guarded with `describe.skipIf(!hasDatabaseUrl)` so a machine without the harness skips rather than fails,
 * matching every other integration spec here.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];
const hasDatabaseUrl = Boolean(DATABASE_URL);

/** Ids unique to this suite, so its rows never collide with another integration spec's. */
const OWNER_ID = '01JU7PREPGROUP0000000OWNER0';
const RECIPE_ID = '55555555-5555-4555-8555-000000000911';
const INGREDIENT_ID = '55555555-5555-4555-8555-000000000912';

/** The two columns this migration adds, as the row spells them. */
interface LineColumns {
    readonly preparation: string | null;
    readonly groupLabel: string | null;
}

describe.skipIf(!hasDatabaseUrl)('recipe_ingredients preparation + group_label (migration 0030)', () => {
    let pool: pg.Pool;

    beforeAll(async () => {
        pool = new pg.Pool({ connectionString: DATABASE_URL });

        await pool.query(
            `INSERT INTO ingredients (id, name, is_user_entered)
             VALUES ($1, 'U26 preparation probe', false)
             ON CONFLICT (id) DO NOTHING`,
            [INGREDIENT_ID],
        );
        await pool.query(
            `INSERT INTO recipes (id, owner_id, title, description, prep_time_minutes, cook_time_minutes,
                                  total_time_minutes, servings, visibility, source_type)
             VALUES ($1, $2, 'U26/U27 preparation + group probe', '', 1, 1, 2, 1, 'private', 'user_created')
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
     * Insert one ingredient line carrying the two new columns.
     *
     * @param columns - The `preparation` / `group_label` values to store.
     * @param sortOrder - Position within the recipe, so a suite can store more than one line.
     * @returns The stored row's two columns.
     * @sideEffect Writes a `recipe_ingredients` row.
     */
    const insertLine = async (columns: LineColumns, sortOrder = 0): Promise<pg.QueryResult> =>
        pool.query(
            `INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit, preparation, group_label,
                                             sort_order, ingredient_name, is_user_entered)
             VALUES ($1, $2, 1, 'cup', $3, $4, $5, 'U26 preparation probe', false)
             RETURNING preparation, group_label`,
            [RECIPE_ID, INGREDIENT_ID, columns.preparation, columns.groupLabel, sortOrder],
        );

    it('stores a preparation and a group label side by side', async () => {
        const { rows } = await insertLine({ preparation: 'finely chopped', groupLabel: 'For the marinade' });

        expect(rows[0]).toEqual({ preparation: 'finely chopped', group_label: 'For the marinade' });
    });

    // ⛔ The dominant case, and the reason both columns are nullable: an ordinary line states neither, and
    // EVERY row written before this migration is exactly this shape. That is what makes the `NOT VALID`
    // checks safe to add without a validating table scan (ADR-0022).
    it('admits a line carrying neither — which is every pre-existing row', async () => {
        const { rows } = await insertLine({ preparation: null, groupLabel: null });

        expect(rows[0]).toEqual({ preparation: null, group_label: null });
    });

    it('treats the two as INDEPENDENT — either may be present without the other', async () => {
        const prepOnly = await insertLine({ preparation: 'melted', groupLabel: null }, 0);
        const groupOnly = await insertLine({ preparation: null, groupLabel: 'Dry' }, 1);

        expect(prepOnly.rows[0]).toEqual({ preparation: 'melted', group_label: null });
        expect(groupOnly.rows[0]).toEqual({ preparation: null, group_label: 'Dry' });
    });

    // ⛔ `''` would be a SECOND spelling of absent, and the read projection omits the key for `NULL` only —
    // so a blank would reach the wire as `preparation: ''`, which `recipeIngredientViewSchema` (`min(1)`)
    // rejects: a body the server can write and no client can read. The exact break `notes` had.
    it('REFUSES a blank preparation', async () => {
        await expect(insertLine({ preparation: '', groupLabel: null })).rejects.toThrow(
            /recipe_ingredients_preparation_present/u,
        );
    });

    it('REFUSES a whitespace-only preparation', async () => {
        await expect(insertLine({ preparation: '   ', groupLabel: null })).rejects.toThrow(
            /recipe_ingredients_preparation_present/u,
        );
    });

    it('REFUSES a blank group label', async () => {
        await expect(insertLine({ preparation: null, groupLabel: '' })).rejects.toThrow(
            /recipe_ingredients_group_label_present/u,
        );
    });

    // ⛔ Sharper than the blank case. Sections are folded from the labels themselves, so `'Dry '` would
    // render a second section under a heading a reader cannot tell from `'Dry'` — invisible, and unmergeable
    // from the editor. The wire trims; the column refuses what a caller bypassing the wire could still send.
    it('REFUSES a whitespace-only group label', async () => {
        await expect(insertLine({ preparation: null, groupLabel: ' ' })).rejects.toThrow(
            /recipe_ingredients_group_label_present/u,
        );
    });

    // The checks are `NOT VALID`, so they skip the backfill scan — but they must still police an UPDATE, not
    // only an INSERT. A check that policed one and not the other would let a blank in by the back door.
    it('enforces both checks on UPDATE as well as INSERT', async () => {
        await insertLine({ preparation: 'diced', groupLabel: 'For the sauce' });

        await expect(
            pool.query(`UPDATE recipe_ingredients SET preparation = '' WHERE recipe_id = $1`, [RECIPE_ID]),
        ).rejects.toThrow(/recipe_ingredients_preparation_present/u);

        await expect(
            pool.query(`UPDATE recipe_ingredients SET group_label = '  ' WHERE recipe_id = $1`, [RECIPE_ID]),
        ).rejects.toThrow(/recipe_ingredients_group_label_present/u);
    });

    // Clearing to NULL is how a cook REMOVES a preparation or ungroups a line, so it must stay legal.
    it('admits clearing either column back to NULL', async () => {
        await insertLine({ preparation: 'diced', groupLabel: 'For the sauce' });

        const { rows } = await pool.query(
            `UPDATE recipe_ingredients SET preparation = NULL, group_label = NULL
             WHERE recipe_id = $1 RETURNING preparation, group_label`,
            [RECIPE_ID],
        );

        expect(rows[0]).toEqual({ preparation: null, group_label: null });
    });

    it('stores the wire’s full length and non-ASCII free text byte for byte', async () => {
        // 120 and 60 are the request-side bounds (`recipeRequestBounds.ts`); the column is unbounded `text`,
        // and this asserts the column is at least as wide as the wire promises — the storage floor, from the
        // storage side.
        const preparation = 'ä'.repeat(120);
        const groupLabel = 'ソース用'.padEnd(60, 'あ');
        const { rows } = await insertLine({ preparation, groupLabel });

        expect(rows[0]).toEqual({ preparation, group_label: groupLabel });
    });

    // ⛔ A grouped recipe's ORDER is the stored order, and sections are folded from CONSECUTIVE RUNS of it —
    // never grouped by label identity. This pins that the database returns the runs in the order they were
    // written, including a label that recurs non-adjacently, which the fold must render as TWO sections.
    it('returns grouped lines in stored order, non-adjacent repeats included', async () => {
        await insertLine({ preparation: null, groupLabel: 'Dry' }, 0);
        await insertLine({ preparation: null, groupLabel: 'Wet' }, 1);
        await insertLine({ preparation: null, groupLabel: 'Dry' }, 2);

        const { rows } = await pool.query(
            'SELECT group_label FROM recipe_ingredients WHERE recipe_id = $1 ORDER BY sort_order',
            [RECIPE_ID],
        );

        expect(rows.map((row: { group_label: string | null }) => row.group_label)).toEqual(['Dry', 'Wet', 'Dry']);
    });
});
