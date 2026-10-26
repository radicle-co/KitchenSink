/**
 * Bulk recipe import (ADR-0072, migration 0059) — account erasure and the test-principal purge both DELETE the user's
 * imports, against a REAL Postgres, as the SERVICE role (`recipe_app`, DML only, ADR-0039).
 *
 * What a unit test over the emitted SQL cannot prove, and what each case is there to catch:
 *
 *  - the statement runs with no GRANT written for the new tables and matches the real column name (`user_id`);
 *  - ONE delete reaches the whole tree: items and snapshot lines go by cascade (kills: a sweep that deletes the header
 *    only on a database whose cascade was dropped, and a hand-delete that would be redundant);
 *  - a BYSTANDER's import, items and lines are untouched (kills: a sweep keyed on nothing, or on the wrong column);
 *  - a recipe the erased user's import saved that the sweep KEEPS (public and published) survives with its ingredient and
 *    its `bound_by`, and the ingredient's `import_line_id` is NULL (kills: CASCADE on that key, which would delete the
 *    ingredients of a donated recipe);
 *  - the purge removes the same tree (kills: a purge that forgot the new tables).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import pg from 'pg';

import { eraseRecipeRows, purgeTestPrincipalRows } from '../../../src/handlers/accountErasureWorker.js';
import { recipeWorkersDb } from '../roleDb.js';

const roleDb = recipeWorkersDb();
const USER_ERASED = '01JIMPORTERASUREERASED0A0';
const USER_BYSTANDER = '01JIMPORTERASUREBYSTAND00';
const KEPT_RECIPE = '77777777-7777-4777-8777-000000000a01';
const PRIVATE_RECIPE = '77777777-7777-4777-8777-000000000a02';
const BYSTANDER_RECIPE = '77777777-7777-4777-8777-000000000a03';
const LOOKUP = '77777777-7777-4777-8777-000000000b01';

describe('bulk import — erasure and purge (LOCAL e2e)', () => {
    let pool: pg.Pool;
    let db: NodePgDatabase<Record<string, never>>;

    beforeAll(async () => {
        pool = new pg.Pool({ connectionString: roleDb.appUrl });
        db = drizzle(pool);
        await db.execute(
            sql`INSERT INTO food_lookups (id, food_id) VALUES (${LOOKUP}, 'import-erasure-food') ON CONFLICT DO NOTHING`,
        );
    });

    afterEach(async () => {
        await db.execute(sql`DELETE FROM recipe_imports WHERE user_id IN (${USER_ERASED}, ${USER_BYSTANDER})`);
        await db.execute(sql`DELETE FROM recipes WHERE id IN (${KEPT_RECIPE}, ${PRIVATE_RECIPE}, ${BYSTANDER_RECIPE})`);
        await db.execute(sql`DELETE FROM account_erasure_jobs WHERE owner_id IN (${USER_ERASED}, ${USER_BYSTANDER})`);
    });

    afterAll(async () => {
        await db.execute(sql`DELETE FROM food_lookups WHERE id = ${LOOKUP}`);
        await pool.end();
    });

    async function recipe(
        id: string,
        ownerId: string,
        visibility: 'public' | 'private',
        status: 'published' | 'draft',
    ) {
        await db.execute(sql`
            INSERT INTO recipes (id, owner_id, title, description, prep_time_minutes, cook_time_minutes, total_time_minutes,
                                 servings, visibility, source_type, status)
            VALUES (${id}, ${ownerId}, 'import erasure probe', '', 1, 1, 2, 1, ${visibility}, 'user_created', ${status})
        `);
    }

    /** One import with one saved item (its recipe), one snapshot line and one ingredient bound from that line. */
    async function seedImport(userId: string, recipeId: string): Promise<string> {
        const created = await db.execute<{ id: string }>(sql`
            INSERT INTO recipe_imports (user_id, match_mode, visibility) VALUES (${userId}, 'bindBest', 'public') RETURNING id
        `);
        const importId = created.rows[0]?.id ?? '';

        await db.execute(sql`
            INSERT INTO recipe_import_items (import_id, ordinal, title, stage, allowance_spent_at, matched_at, saved_at, statement_kind, recipe_id)
            VALUES (${importId}, 0, 'Soup', 'saved', now(), now(), now(), 'authored', ${recipeId})
        `);

        const line = await db.execute<{ id: string }>(sql`
            INSERT INTO recipe_import_lines (import_id, ordinal, line_index, food_index, source_line, line_digest, judgement_digest, phrase, unit)
            VALUES (${importId}, 0, 0, 0, '1 cup flour', 'ld', 'jd', 'flour', 'cup') RETURNING id
        `);

        await db.execute(sql`
            INSERT INTO ingredients (recipe_id, food_lookup_id, quantity, unit, bound_by, import_line_id)
            VALUES (${recipeId}, ${LOOKUP}, 1, 'cup', 'autoBest', ${line.rows[0]?.id ?? ''})
        `);

        return importId;
    }

    async function counts(userId: string): Promise<{ imports: number; items: number; lines: number }> {
        const result = await db.execute<{ imports: number; items: number; lines: number }>(sql`
            SELECT (SELECT count(*) FROM recipe_imports WHERE user_id = ${userId})::int AS imports,
                   (SELECT count(*) FROM recipe_import_items i JOIN recipe_imports h ON h.id = i.import_id WHERE h.user_id = ${userId})::int AS items,
                   (SELECT count(*) FROM recipe_import_lines l JOIN recipe_imports h ON h.id = l.import_id WHERE h.user_id = ${userId})::int AS lines
        `);

        return result.rows[0] ?? { imports: -1, items: -1, lines: -1 };
    }

    it("⛔ account erasure deletes the erased user's whole import tree and none of a bystander's", async () => {
        await recipe(PRIVATE_RECIPE, USER_ERASED, 'private', 'draft');
        await recipe(BYSTANDER_RECIPE, USER_BYSTANDER, 'private', 'draft');
        await seedImport(USER_ERASED, PRIVATE_RECIPE);
        await seedImport(USER_BYSTANDER, BYSTANDER_RECIPE);

        await eraseRecipeRows(db, USER_ERASED, []);

        expect(await counts(USER_ERASED)).toEqual({ imports: 0, items: 0, lines: 0 });
        expect(await counts(USER_BYSTANDER)).toEqual({ imports: 1, items: 1, lines: 1 });
    });

    it('⛔ a recipe the sweep KEEPS survives its import with its ingredient and bound_by, and a NULL import link', async () => {
        await recipe(KEPT_RECIPE, USER_ERASED, 'public', 'published');
        await seedImport(USER_ERASED, KEPT_RECIPE);

        await eraseRecipeRows(db, USER_ERASED, []);

        const kept = await db.execute<{ bound_by: string | null; import_line_id: string | null }>(
            sql`SELECT bound_by, import_line_id FROM ingredients WHERE recipe_id = ${KEPT_RECIPE}`,
        );

        expect(kept.rows).toEqual([{ bound_by: 'autoBest', import_line_id: null }]);
        expect(await counts(USER_ERASED)).toEqual({ imports: 0, items: 0, lines: 0 });
    });

    it('⛔ the test-principal purge deletes the same tree, so a reset principal starts with no import', async () => {
        await recipe(PRIVATE_RECIPE, USER_ERASED, 'private', 'draft');
        await recipe(BYSTANDER_RECIPE, USER_BYSTANDER, 'private', 'draft');
        await seedImport(USER_ERASED, PRIVATE_RECIPE);
        await seedImport(USER_BYSTANDER, BYSTANDER_RECIPE);

        await purgeTestPrincipalRows(db, USER_ERASED);

        expect(await counts(USER_ERASED)).toEqual({ imports: 0, items: 0, lines: 0 });
        expect(await counts(USER_BYSTANDER)).toEqual({ imports: 1, items: 1, lines: 1 });
    });
});
