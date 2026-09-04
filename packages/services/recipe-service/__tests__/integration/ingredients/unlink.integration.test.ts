/**
 * U12a (integration, real Docker Postgres) — the recipe-side ingredient UNLINK, half one of the
 * two-service catalog reset. Requirements R44–R46; plan
 * `docs/plans/2026-08-20-001-fix-ingredient-resolution-quality-plan.md` §U12.
 *
 * ⛔ WHY THIS TIER, AND NOT A MOCKED STORE TEST. Three of the properties this unit exists for are
 * structurally invisible to a fake:
 *
 *  1. **`recipe_ingredients.ingredient_id` is `NOT NULL REFERENCES ingredients(id)` with no `ON DELETE`.**
 *     The plan chose "null in place, delete nothing" precisely because a delete raises a foreign-key
 *     violation and, forced through, would take user recipes with it. Only a real Postgres can be asked
 *     whether the junction rows survived and still resolve.
 *  2. **The post-condition is asserted INSIDE the transaction so a violation ROLLS BACK.** A fake store
 *     can be made to return violating counts, but only a real transaction can show that the update was
 *     undone. The trigger below manufactures exactly that violation.
 *  3. **The columns and the CHECK constraint are real.** `ingredients_food_resolution_status_check`
 *     constrains `food_resolution_status IN (…)`; a NULL passes it (a CHECK evaluating to NULL is not a
 *     violation), and that is an assumption about Postgres semantics, not about our code.
 *
 * Skipped in lockstep with the global setup when the harness DB is not configured.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';

import { createRecipeDrizzle, type RecipeDrizzle } from '../../../src/database/client.js';
import {
    PRODUCTION_STAGE,
    createIngredientLinkStore,
    describeDatabaseTarget,
    describeTargetToken,
    runIngredientUnlink,
    type IngredientLinkStore,
    type UnlinkCliOptions,
} from '../../../src/ingredients/unlinkCli.js';
import { isIngredientUnlinkIncompleteError, isUnlinkRefusedError } from '../../../src/ingredients/unlinkCli.errors.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];
const hasDatabaseUrl = Boolean(DATABASE_URL);

/** Ids unique to this suite so its rows never collide with another integration spec's. */
const RECIPE_ID = '00000000-0000-4000-8000-0000012a0001';
const OWNER = '01JU12AUNLINK000000000OWNER';
const BACKED_A = '00000000-0000-4000-8000-00000012a001';
const BACKED_B = '00000000-0000-4000-8000-00000012a002';
const STATUS_ONLY = '00000000-0000-4000-8000-00000012a003';
const FREEFORM = '00000000-0000-4000-8000-00000012a004';
const SUITE_INGREDIENT_IDS = [BACKED_A, BACKED_B, STATUS_ONLY, FREEFORM];

/**
 * The token this suite's REAL connection must be named by (PR #91 review).
 *
 * Read in `beforeAll` from the live server through the same `describeTargetToken` the command demands, so
 * these cases walk the loop an operator walks — a dry run prints the target, the writing run passes it back —
 * rather than restating a literal that could drift from what the server actually reports.
 */
let liveTargetToken: string;

/** A complete, valid options object; each test overrides only the field it is about. */
function makeOptions(overrides: Partial<UnlinkCliOptions> = {}): UnlinkCliOptions {
    return {
        stage: 'sandbox',
        confirm: 'sandbox',
        allowProd: false,
        dryRun: false,
        confirmTarget: liveTargetToken,
        ...overrides,
    };
}

describe.skipIf(!hasDatabaseUrl)('ingredient unlink (integration)', () => {
    let pool: pg.Pool;
    let db: RecipeDrizzle;
    let store: IngredientLinkStore;

    beforeAll(async () => {
        pool = new pg.Pool({ connectionString: DATABASE_URL });
        db = createRecipeDrizzle(pool);
        store = createIngredientLinkStore(db);
        liveTargetToken = describeTargetToken(await describeDatabaseTarget(pool));
    });

    afterAll(async () => {
        await pool?.end();
    });

    /**
     * Two food-backed catalog rows, one carrying only a resolution verdict (a `NOT_FOUND` line has no
     * `food_id`), one freeform row — plus a recipe whose lines reference three of them. The mix matters:
     * the unlink must clear the verdict-only row too, and must leave the freeform row alone.
     */
    beforeEach(async () => {
        await pool.query('DELETE FROM recipe_ingredients WHERE recipe_id = $1', [RECIPE_ID]);
        await pool.query('DELETE FROM recipes WHERE id = $1', [RECIPE_ID]);
        await pool.query('DELETE FROM ingredients WHERE id = ANY($1::uuid[])', [SUITE_INGREDIENT_IDS]);

        await pool.query(
            `INSERT INTO ingredients (id, name, food_id, food_resolution_status, is_user_entered, search_vector)
             VALUES ($1, 'Unsalted butter', '01JU12ACATALOG0000000BUTTR', 'RESOLVED', false, to_tsvector('english', 'Unsalted butter')),
                    ($2, 'All-purpose flour', '01JU12ACATALOG0000000FLOUR', 'RESOLVED', false, to_tsvector('english', 'All-purpose flour')),
                    ($3, 'Heirloom something', NULL, 'NOT_FOUND', false, to_tsvector('english', 'Heirloom something')),
                    ($4, 'U12a grandma''s secret', NULL, NULL, true, to_tsvector('english', 'U12a grandma''s secret'))`,
            SUITE_INGREDIENT_IDS,
        );
        await pool.query(
            `INSERT INTO recipes (id, owner_id, title, servings, prep_time_minutes, cook_time_minutes, total_time_minutes)
             VALUES ($1, $2, 'U12a unlink fixture', 2, 5, 10, 15)`,
            [RECIPE_ID, OWNER],
        );
        await pool.query(
            `INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit, sort_order, ingredient_name, is_user_entered)
             VALUES ($1, $2, 1, 'cup', 0, 'Unsalted butter', false),
                    ($1, $3, 2, 'cup', 1, 'All-purpose flour', false),
                    ($1, $4, 1, 'unit', 2, 'Heirloom something', false)`,
            [RECIPE_ID, BACKED_A, BACKED_B, STATUS_ONLY],
        );
    });

    afterEach(async () => {
        await pool.query('DELETE FROM recipe_ingredients WHERE recipe_id = $1', [RECIPE_ID]);
        await pool.query('DELETE FROM recipes WHERE id = $1', [RECIPE_ID]);
        await pool.query('DELETE FROM ingredients WHERE id = ANY($1::uuid[])', [SUITE_INGREDIENT_IDS]);
    });

    /** The suite's own rows, by id, so a concurrently-seeded catalog cannot perturb the assertions. */
    async function suiteRows(): Promise<
        { id: string; food_id: string | null; food_resolution_status: string | null }[]
    > {
        const { rows } = await pool.query<{
            id: string;
            food_id: string | null;
            food_resolution_status: string | null;
        }>('SELECT id, food_id, food_resolution_status FROM ingredients WHERE id = ANY($1::uuid[]) ORDER BY id', [
            SUITE_INGREDIENT_IDS,
        ]);

        return rows;
    }

    /** How many junction lines this suite's recipe has. */
    async function suiteLineCount(): Promise<number> {
        const { rows } = await pool.query<{ n: number }>(
            'SELECT count(*)::int AS n FROM recipe_ingredients WHERE recipe_id = $1',
            [RECIPE_ID],
        );

        return rows[0]?.n ?? 0;
    }

    it('nulls food_id AND food_resolution_status in place, on every linked row', async () => {
        await runIngredientUnlink(store, makeOptions());

        expect(await suiteRows()).toEqual(
            [...SUITE_INGREDIENT_IDS].sort().map((id: string) => ({ id, food_id: null, food_resolution_status: null })),
        );
    });

    it('deletes NO ingredients row — the catalog rows survive with their names intact', async () => {
        await runIngredientUnlink(store, makeOptions());

        const { rows } = await pool.query<{ n: number }>(
            'SELECT count(*)::int AS n FROM ingredients WHERE id = ANY($1::uuid[])',
            [SUITE_INGREDIENT_IDS],
        );

        expect(rows[0]?.n).toBe(SUITE_INGREDIENT_IDS.length);
    });

    it('deletes NO recipe_ingredients line, and every line still resolves to its catalog row', async () => {
        expect(await suiteLineCount()).toBe(3);

        await runIngredientUnlink(store, makeOptions());

        expect(await suiteLineCount()).toBe(3);

        const { rows } = await pool.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM recipe_ingredients ri
               JOIN ingredients i ON i.id = ri.ingredient_id
              WHERE ri.recipe_id = $1`,
            [RECIPE_ID],
        );

        expect(rows[0]?.n).toBe(3);
    });

    it('leaves the user-entered row untouched — it never had a link to drop', async () => {
        await runIngredientUnlink(store, makeOptions());

        const { rows } = await pool.query<{ is_user_entered: boolean; name: string }>(
            'SELECT is_user_entered, name FROM ingredients WHERE id = $1',
            [FREEFORM],
        );

        expect(rows[0]).toEqual({ is_user_entered: true, name: "U12a grandma's secret" });
    });

    it('is idempotent — a second run finds nothing left to unlink', async () => {
        await runIngredientUnlink(store, makeOptions());

        await expect(runIngredientUnlink(store, makeOptions())).resolves.toMatchObject({
            outcome: 'unlinked',
            linkedBefore: 0,
            unlinked: 0,
        });
    });

    describe('the dry run', () => {
        it('reports the linked rows and writes NOTHING', async () => {
            const before = await suiteRows();

            const result = await runIngredientUnlink(store, makeOptions({ dryRun: true }));

            expect(result.outcome).toBe('reported');
            expect(result.unlinked).toBe(0);
            expect(result.linkedBefore).toBeGreaterThanOrEqual(3);
            expect(await suiteRows()).toEqual(before);
        });
    });

    describe('the production guard', () => {
        it('refuses a production run without the flag and writes NOTHING', async () => {
            const before = await suiteRows();

            await expect(
                runIngredientUnlink(store, makeOptions({ stage: PRODUCTION_STAGE, confirm: PRODUCTION_STAGE })),
            ).rejects.toSatisfy(isUnlinkRefusedError);
            expect(await suiteRows()).toEqual(before);
        });

        it('refuses a stage/confirmation mismatch and writes NOTHING', async () => {
            const before = await suiteRows();

            await expect(runIngredientUnlink(store, makeOptions({ confirm: 'pr-7' }))).rejects.toSatisfy(
                isUnlinkRefusedError,
            );
            expect(await suiteRows()).toEqual(before);
        });
    });

    describe("the target it names is the SERVER's own answer", () => {
        it('reports the database and role the connection actually reached, not the connection string', async () => {
            const target = await describeDatabaseTarget(pool);

            expect(target).toMatchObject({ database: new URL(DATABASE_URL ?? '').pathname.slice(1) });
            expect(target.port).toBeGreaterThan(0);
            expect(target.user).not.toBe('');
        });
    });

    describe('the post-condition rolls the transaction back', () => {
        /**
         * A statement-level `AFTER UPDATE` trigger that re-introduces one linked row. It INSERTs (never
         * updates), so it cannot re-fire itself, and it is the only way to manufacture the
         * "update ran, links survived" state the post-condition exists to catch.
         */
        const SMUGGLED = '00000000-0000-4000-8000-00000012a099';

        beforeEach(async () => {
            await pool.query(`
                CREATE OR REPLACE FUNCTION u12a_smuggle_link() RETURNS trigger AS $$
                BEGIN
                    INSERT INTO ingredients (id, name, food_id, food_resolution_status, is_user_entered)
                    VALUES ('${SMUGGLED}', 'U12a smuggled', '01JU12ASMUGGLED0000000000', 'RESOLVED', false)
                    ON CONFLICT (id) DO NOTHING;
                    RETURN NULL;
                END;
                $$ LANGUAGE plpgsql;
            `);
            await pool.query(
                `CREATE OR REPLACE TRIGGER u12a_smuggle_link_trigger AFTER UPDATE ON ingredients
                 FOR EACH STATEMENT EXECUTE FUNCTION u12a_smuggle_link()`,
            );
        });

        afterEach(async () => {
            await pool.query('DROP TRIGGER IF EXISTS u12a_smuggle_link_trigger ON ingredients');
            await pool.query('DROP FUNCTION IF EXISTS u12a_smuggle_link()');
            await pool.query('DELETE FROM ingredients WHERE id = $1', [SMUGGLED]);
        });

        it('rolls the whole update back when a linked row survives it', async () => {
            const before = await suiteRows();

            await expect(runIngredientUnlink(store, makeOptions())).rejects.toSatisfy(
                isIngredientUnlinkIncompleteError,
            );

            expect(await suiteRows()).toEqual(before);
        });

        it('leaves nothing behind — the row the trigger smuggled in is rolled back too', async () => {
            await runIngredientUnlink(store, makeOptions()).catch(() => undefined);

            const { rows } = await pool.query<{ n: number }>(
                'SELECT count(*)::int AS n FROM ingredients WHERE id = $1',
                [SMUGGLED],
            );

            expect(rows[0]?.n).toBe(0);
        });
    });

    /**
     * ⛔ THE GUARD AGAINST A REAL CONNECTION (PR #91 review). The unit suite proves the pure rule; only this
     * tier can prove the token the command demands is the one a real server produces — and that a run naming
     * a DIFFERENT database is refused having written nothing to this one.
     */
    describe('the confirmation must name the database this process actually opened', () => {
        it('refuses a run that names another database, and writes NOTHING', async () => {
            const before = await suiteRows();

            await expect(
                runIngredientUnlink(store, makeOptions({ confirmTarget: 'kitchensink_recipes@10.0.9.2:5432' })),
            ).rejects.toSatisfy(isUnlinkRefusedError);
            expect(await suiteRows()).toEqual(before);
        });

        it('refuses a run that names no target at all, and writes NOTHING', async () => {
            const before = await suiteRows();

            await expect(runIngredientUnlink(store, makeOptions({ confirmTarget: undefined }))).rejects.toSatisfy(
                isUnlinkRefusedError,
            );
            expect(await suiteRows()).toEqual(before);
        });

        it('closes the loop: the token a dry run reports is the one the writing run is accepted with', async () => {
            const reported = await runIngredientUnlink(store, makeOptions({ dryRun: true }));

            await expect(
                runIngredientUnlink(store, makeOptions({ confirmTarget: reported.target })),
            ).resolves.toMatchObject({ outcome: 'unlinked' });
        });

        it('refuses a pr-{N} stage against this non-per-PR database without anyone typing anything', async () => {
            await expect(runIngredientUnlink(store, makeOptions({ stage: 'pr-7', confirm: 'pr-7' }))).rejects.toSatisfy(
                isUnlinkRefusedError,
            );
        });
    });
});
