/**
 * The bulk import purge (ADR-0072 §9) against a REAL Postgres, as the SERVICE role (`recipe_app`, DML only, ADR-0039).
 *
 * What a unit test over a fake pool cannot prove, and what each case is there to catch:
 *
 *  - the 30-day edge is on the right side, read from the LAST WRITE (`updated_at`): 30 days and a minute is deleted, 30 days
 *    less a minute is kept (kills: `>` for `<`, a different horizon, `created_at` for `updated_at`);
 *  - ONE delete reaches the whole tree: the items and the snapshot lines go by cascade, with no grant written for them;
 *  - a recipe the import SAVED stays, with its ingredient and `bound_by`, and the link to the deleted line is NULL (kills:
 *    CASCADE on that key, which would delete a cook's recipe lines because their import aged out);
 *  - the allowance ledger is untouched: a purge is retention, not a refund (kills: a sweep that "tidies" the ledger too);
 *  - another cook's recent import is untouched;
 *  - a backlog larger than one batch is drained within a tick (kills: a loop that stops after one batch);
 *  - an aged import another transaction holds is skipped, not waited for and not deleted (kills: removing SKIP LOCKED);
 *  - the oldest-age gauge reads the real oldest row (kills: reading the newest import, or an age that is not in seconds).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import {
    IMPORT_PURGE_BATCH_SIZE,
    oldestImportAgeSeconds,
    purgeFinishedImports,
} from '../../../src/import/importPurge.js';
import { recipeWorkersDb } from '../roleDb.js';

const roleDb = recipeWorkersDb();
const USER = '01JIMPORTPURGEE2E0000000A0';
const OTHER = '01JIMPORTPURGEE2E0000000B0';
const RECIPE = '77777777-7777-4777-8777-000000000c01';
const LOOKUP = '77777777-7777-4777-8777-000000000c02';

describe('bulk import purge (LOCAL e2e)', () => {
    let pool: pg.Pool;

    beforeAll(async () => {
        pool = new pg.Pool({ connectionString: roleDb.appUrl });
        await pool.query(
            `INSERT INTO food_lookups (id, food_id) VALUES ($1, 'import-purge-food') ON CONFLICT DO NOTHING`,
            [LOOKUP],
        );
    });

    afterEach(async () => {
        await pool.query(`DELETE FROM recipe_imports WHERE user_id = ANY($1)`, [[USER, OTHER]]);
        await pool.query(`DELETE FROM recipes WHERE id = $1`, [RECIPE]);
        await pool.query(`DELETE FROM import_allowance_events WHERE user_id = ANY($1)`, [[USER, OTHER]]);
    });

    afterAll(async () => {
        await pool.query(`DELETE FROM food_lookups WHERE id = $1`, [LOOKUP]);
        await pool.end();
    });

    /** An import whose last write was `age` ago (a Postgres interval), with one item and one snapshot line. */
    async function importAged(userId: string, age: string, recipeId?: string): Promise<{ id: string; lineId: string }> {
        const created = await pool.query<{ id: string }>(
            `INSERT INTO recipe_imports (user_id, expected_total, match_mode, visibility, created_at, updated_at)
             VALUES ($1, 1, 'bindBest', 'public', now() - $2::interval, now() - $2::interval) RETURNING id`,
            [userId, age],
        );
        const id = created.rows[0]?.id ?? '';

        await (recipeId === undefined
            ? pool.query(
                  `INSERT INTO recipe_import_items (import_id, ordinal, title, payload, stage) VALUES ($1, 0, 'Soup', '{}'::jsonb, 'received')`,
                  [id],
              )
            : pool.query(
                  `INSERT INTO recipe_import_items (import_id, ordinal, title, stage, allowance_spent_at, matched_at, saved_at, statement_kind, recipe_id)
                   VALUES ($1, 0, 'Soup', 'saved', now(), now(), now(), 'authored', $2)`,
                  [id, recipeId],
              ));
        const line = await pool.query<{ id: string }>(
            `INSERT INTO recipe_import_lines (import_id, ordinal, line_index, food_index, source_line, line_digest, judgement_digest, phrase, unit)
             VALUES ($1, 0, 0, 0, '1 cup flour', 'ld', 'jd', 'flour', 'cup') RETURNING id`,
            [id],
        );

        return { id, lineId: line.rows[0]?.id ?? '' };
    }

    async function treeOf(importId: string): Promise<{ imports: number; items: number; lines: number }> {
        const result = await pool.query<{ imports: number; items: number; lines: number }>(
            `SELECT (SELECT count(*) FROM recipe_imports WHERE id = $1)::int AS imports,
                    (SELECT count(*) FROM recipe_import_items WHERE import_id = $1)::int AS items,
                    (SELECT count(*) FROM recipe_import_lines WHERE import_id = $1)::int AS lines`,
            [importId],
        );

        return result.rows[0] ?? { imports: -1, items: -1, lines: -1 };
    }

    it('⛔ deletes an import 30 days and a minute after its last write, with its items and lines, and keeps the one a minute short', async () => {
        const old = await importAged(USER, '30 days 1 minute');
        const young = await importAged(USER, '29 days 23 hours 59 minutes');

        const purged = await purgeFinishedImports(pool);

        expect(purged).toBe(1);
        expect(await treeOf(old.id)).toStrictEqual({ imports: 0, items: 0, lines: 0 });
        expect(await treeOf(young.id)).toStrictEqual({ imports: 1, items: 1, lines: 1 });
    });

    it('reads the last WRITE, not the creation: an old import written to yesterday is kept', async () => {
        const touched = await importAged(USER, '90 days');

        await pool.query(`UPDATE recipe_imports SET updated_at = now() - interval '1 day' WHERE id = $1`, [touched.id]);

        expect(await purgeFinishedImports(pool)).toBe(0);
        expect(await treeOf(touched.id)).toStrictEqual({ imports: 1, items: 1, lines: 1 });
    });

    it('⛔ keeps the recipe the import saved, with its ingredient and bound_by, and a NULL link to the deleted line', async () => {
        await pool.query(
            `INSERT INTO recipes (id, owner_id, title, description, prep_time_minutes, cook_time_minutes, total_time_minutes,
                                  servings, visibility, source_type, status)
             VALUES ($1, $2, 'purge probe', '', 1, 1, 2, 1, 'public', 'user_created', 'draft')`,
            [RECIPE, USER],
        );
        const old = await importAged(USER, '31 days', RECIPE);

        await pool.query(
            `INSERT INTO ingredients (recipe_id, food_lookup_id, quantity, unit, bound_by, import_line_id)
             VALUES ($1, $2, 1, 'cup', 'autoBest', $3)`,
            [RECIPE, LOOKUP, old.lineId],
        );

        await purgeFinishedImports(pool);

        const kept = await pool.query(`SELECT bound_by, import_line_id FROM ingredients WHERE recipe_id = $1`, [
            RECIPE,
        ]);
        const recipe = await pool.query(`SELECT 1 FROM recipes WHERE id = $1`, [RECIPE]);

        expect(recipe.rows).toHaveLength(1);
        expect(kept.rows).toStrictEqual([{ bound_by: 'autoBest', import_line_id: null }]);
    });

    it('leaves the allowance ledger and another cook’s recent import alone', async () => {
        await importAged(USER, '45 days');
        const theirs = await importAged(OTHER, '2 days');
        await pool.query(`INSERT INTO import_allowance_events (user_id, channel, units) VALUES ($1, 'bulk', 5)`, [
            USER,
        ]);

        await purgeFinishedImports(pool);

        const ledger = await pool.query(`SELECT units FROM import_allowance_events WHERE user_id = $1`, [USER]);

        expect(ledger.rows).toStrictEqual([{ units: 5 }]);
        expect(await treeOf(theirs.id)).toStrictEqual({ imports: 1, items: 1, lines: 1 });
    });

    /**
     * Review finding 5 on #185-#188: the purge picked its rows by age and then deleted by id, so an import a cook held at
     * that moment was deleted under them. A row another transaction holds is now SKIPPED, not waited for and not deleted;
     * the next tick, 15 minutes later, sees it again with whatever `updated_at` that transaction left. The purge's own
     * connection carries a short `lock_timeout`, so a purge that WAITED for the lock fails this case instead of hanging.
     */
    it('⛔ skips an aged import another transaction holds, without waiting for it, and deletes the rest', async () => {
        const held = await importAged(USER, '40 days');
        const free = await importAged(USER, '41 days');
        const cook = await pool.connect();
        const purger = new pg.Pool({ connectionString: roleDb.appUrl, options: '-c lock_timeout=2000' });

        try {
            await cook.query('BEGIN');
            await cook.query(`SELECT 1 FROM recipe_imports WHERE id = $1 FOR UPDATE`, [held.id]);

            expect(await purgeFinishedImports(purger)).toBe(1);
            expect(await treeOf(free.id)).toStrictEqual({ imports: 0, items: 0, lines: 0 });
            expect(await treeOf(held.id)).toStrictEqual({ imports: 1, items: 1, lines: 1 });
        } finally {
            await cook.query('ROLLBACK');
            cook.release();
            await purger.end();
        }
    });

    it('reads the age of the oldest import left, from the database’s own clock, and 0 when there is none', async () => {
        expect(await oldestImportAgeSeconds(pool)).toBe(0);

        await importAged(USER, '3 days');
        await importAged(OTHER, '2 days');

        const age = await oldestImportAgeSeconds(pool);

        expect(age).toBeGreaterThanOrEqual(3 * 86_400);
        expect(age).toBeLessThan(3 * 86_400 + 60);
    });

    it('drains a backlog larger than one batch within a tick', async () => {
        const total = IMPORT_PURGE_BATCH_SIZE + 2;

        await pool.query(
            `INSERT INTO recipe_imports (user_id, expected_total, match_mode, visibility, created_at, updated_at)
             SELECT $1, 1, 'bindBest', 'public', now() - interval '40 days', now() - interval '40 days'
               FROM generate_series(1, $2)`,
            [USER, total],
        );

        expect(await purgeFinishedImports(pool)).toBe(total);

        const left = await pool.query(`SELECT count(*)::int AS n FROM recipe_imports WHERE user_id = $1`, [USER]);

        expect(left.rows).toStrictEqual([{ n: 0 }]);
    });
});
