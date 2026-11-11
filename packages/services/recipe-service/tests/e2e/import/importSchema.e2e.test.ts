/**
 * THE BULK-IMPORT TABLES (migrations 0059 and 0060, ADR-0072) against a REAL migrated PostgreSQL — LOCAL e2e,
 * `docs/CODING_STANDARDS.md` §7.1a, connected as the SERVICE role (`recipe_app`, DML only, ADR-0039).
 *
 * Every claim is a claim about the DATABASE, and a mocked DAL can observe none of them: that the migrations applied, that
 * each CHECK is ENFORCED on a real INSERT (a test that only read `pg_constraint` would pass against a constraint Postgres
 * never applies), that the service role can use the tables with no GRANT written in the SQL, and what each foreign key does
 * when its parent goes. The mutation each group is there to catch:
 *
 *  - the shape: a column dropped or renamed (the drizzle mirrors are separately executed by `schemaModelConformance`);
 *  - the header/item/line CHECKs: each loosened or removed, one rejected row per rule, and the legitimate row beside it
 *    so a CHECK that rejects everything cannot pass either;
 *  - the per-recipe statement (ADR-0072 §9): "I wrote this" cannot carry a citation, "From a source" cannot lack one or its
 *    kind, and a saved item always has a statement;
 *  - `saved_at` / `allowance_spent_at` are facts of their own: deleting the draft or the purged job leaves the item saved
 *    and paid (the next `advance` must not create the recipe or spend the unit again);
 *  - ONE parse job per item and ONE item per recipe (the partial UNIQUE indexes);
 *  - the snapshot OUTLIVES its parse job (no foreign key to the job tables);
 *  - cascades: a header takes its items and lines with it; the recipes an import saved survive their import, with
 *    `ingredients.import_line_id` set NULL (kills: CASCADE or RESTRICT on that key);
 *  - `ingredients.bound_by` accepts exactly the six origins and NULL.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { ensureFoodLookup } from '../../support/lineChain.js';
import { recipeDb } from '../../support/roleDb.js';

const roleDb = recipeDb();

const USER = '01JIMPORTSCHEMAE2E000001';
const OTHER_USER = '01JIMPORTSCHEMAE2E000002';
const RECIPE_A = '66666666-6666-4666-8666-000000000a01';
const RECIPE_B = '66666666-6666-4666-8666-000000000a02';
const LOOKUP = '66666666-6666-4666-8666-000000000a03';
const FOOD_ID = '01JIMPORTSCHEMAE2E0000FOOD';
const JOB_A = '66666666-6666-4666-8666-000000000b01';
const JOB_B = '66666666-6666-4666-8666-000000000b02';

const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';

type Columns = Record<string, unknown>;

describe('the bulk-import tables (LOCAL e2e; migrations 0059, 0060, 0066)', () => {
    let pool: pg.Pool;

    beforeAll(async () => {
        pool = new pg.Pool({ connectionString: roleDb.appUrl, max: 4 });

        await ensureFoodLookup(pool, { arm: 'shared', foodId: FOOD_ID, id: LOOKUP });

        for (const id of [RECIPE_A, RECIPE_B]) {
            await pool.query(
                `INSERT INTO recipes (id, owner_id, title, description, prep_time_minutes, cook_time_minutes,
                                      total_time_minutes, servings, visibility, source_type, status)
                 VALUES ($1, $2, 'import schema probe', '', 1, 1, 2, 1, 'private', 'user_created', 'draft')
                 ON CONFLICT (id) DO NOTHING`,
                [id, USER],
            );
        }
    });

    afterEach(async () => {
        await pool.query('DELETE FROM recipe_imports WHERE user_id = ANY($1)', [[USER, OTHER_USER]]);
        await pool.query('DELETE FROM recipe_parse_jobs WHERE id = ANY($1)', [[JOB_A, JOB_B]]);
        await pool.query('DELETE FROM ingredients WHERE recipe_id = ANY($1)', [[RECIPE_A, RECIPE_B]]);
        await pool.query('UPDATE recipes SET deleted_at = NULL WHERE id = ANY($1)', [[RECIPE_A, RECIPE_B]]);
    });

    afterAll(async () => {
        await pool.query('DELETE FROM recipes WHERE id = ANY($1)', [[RECIPE_A, RECIPE_B]]);
        await pool.query('DELETE FROM food_lookups WHERE id = $1', [LOOKUP]);
        await pool.end();
    });

    // ── helpers ───────────────────────────────────────────────────────────────────────────────────────────────────

    /** INSERT one row from an object of columns; returns the new row. */
    async function insert(table: string, columns: Columns): Promise<Record<string, unknown>> {
        const names = Object.keys(columns);
        const marks = names.map((_name, index) => `$${String(index + 1)}`);
        const result = await pool.query(
            `INSERT INTO ${table} (${names.join(', ')}) VALUES (${marks.join(', ')}) RETURNING *`,
            Object.values(columns),
        );

        return result.rows[0] as Record<string, unknown>;
    }

    async function newImport(extra: Columns = {}, userId = USER): Promise<string> {
        const row = await insert('recipe_imports', {
            user_id: userId,
            expected_total: 5,
            match_mode: 'review',
            visibility: 'private',
            ...extra,
        });

        return row['id'] as string;
    }

    /** A legitimate received item: payload present, nothing else. */
    function receivedItem(importId: string, ordinal: number, extra: Columns = {}): Columns {
        return { import_id: importId, ordinal, title: 'Soup', payload: JSON.stringify({ title: 'Soup' }), ...extra };
    }

    /** A legitimate matched item (paid, job attached). */
    function matchedItem(importId: string, ordinal: number, jobId: string | null, extra: Columns = {}): Columns {
        return receivedItem(importId, ordinal, {
            stage: 'matched',
            allowance_spent_at: new Date(),
            matched_at: new Date(),
            parse_job_id: jobId,
            ...extra,
        });
    }

    async function newJob(id: string): Promise<void> {
        await pool.query(
            `INSERT INTO recipe_parse_jobs (id, owner_id, status, expires_at) VALUES ($1, $2, 'running', now() + interval '1 day')`,
            [id, USER],
        );
    }

    /** A legitimate snapshot line for item `ordinal`. */
    function line(importId: string, ordinal: number, extra: Columns = {}): Columns {
        return {
            import_id: importId,
            ordinal,
            line_index: 0,
            food_index: 0,
            source_line: '1 cup flour',
            line_digest: 'ld',
            judgement_digest: 'jd',
            phrase: 'flour',
            unit: 'cup',
            ...extra,
        };
    }

    /** A line that proposed a food, owing a review. */
    const proposed = (extra: Columns = {}): Columns => ({
        matched_by: 'lexical',
        food_id: 'food-1',
        review: 'owed',
        verification_key: 'vk-1',
        ...extra,
    });

    async function count(sql: string, params: unknown[] = []): Promise<number> {
        const result = await pool.query(sql, params);

        return (result.rows[0] as { n: number }).n;
    }

    const refused = (promise: Promise<unknown>, code: string) => expect(promise).rejects.toMatchObject({ code });

    // ── the shape ─────────────────────────────────────────────────────────────────────────────────────────────────

    describe('the migrated shape', () => {
        async function columnsOf(table: string): Promise<string[]> {
            const result = await pool.query(
                `SELECT column_name FROM information_schema.columns WHERE table_name = $1 ORDER BY column_name`,
                [table],
            );

            return result.rows.map((row: { column_name: string }) => row.column_name);
        }

        it('recipe_imports', async () => {
            expect(await columnsOf('recipe_imports')).toEqual([
                'created_at',
                'cursor_ordinal',
                'expected_total',
                'id',
                'match_mode',
                'review_closed_at',
                'updated_at',
                'user_id',
                'visibility',
            ]);
        });

        it('recipe_import_items', async () => {
            expect(await columnsOf('recipe_import_items')).toEqual([
                'allowance_spent_at',
                'citation',
                'created_at',
                'decision_rev',
                'import_id',
                'matched_at',
                'ordinal',
                'parse_generation',
                'parse_job_id',
                'payload',
                'recipe_id',
                'review',
                'saved_at',
                'source_kind',
                'stage',
                'statement_kind',
                'title',
                'updated_at',
                'visibility',
            ]);
        });

        it('recipe_import_lines holds NO food name, NO verdict and NO bound_by (the ingredient owns that)', async () => {
            expect(await columnsOf('recipe_import_lines')).toEqual([
                'candidates',
                'created_at',
                'food_id',
                'food_index',
                'food_variant_id',
                'id',
                'import_id',
                'judgement_digest',
                'line_digest',
                'line_index',
                'margin',
                'matched_by',
                'ordinal',
                'phrase',
                'picked_against_digest',
                'picked_as_written',
                'picked_food_id',
                'picked_food_variant_id',
                'preparation',
                'quantity',
                'quantity_high',
                'review',
                'rung',
                'saved_verification_key',
                'source_line',
                'stated_quantity',
                'stated_quantity_high',
                'stated_unit',
                'unit',
                'verification_key',
            ]);
        });

        it('ingredients gained exactly bound_by and import_line_id', async () => {
            const result = await pool.query(
                `SELECT column_name, is_nullable FROM information_schema.columns
                  WHERE table_name = 'ingredients' AND column_name IN ('bound_by', 'import_line_id') ORDER BY column_name`,
            );

            expect(result.rows).toEqual([
                { column_name: 'bound_by', is_nullable: 'YES' },
                { column_name: 'import_line_id', is_nullable: 'YES' },
            ]);
        });

        it("indexes the keys a parent delete scans, and the cook's imports", async () => {
            const result = await pool.query(
                `SELECT indexdef FROM pg_indexes
                  WHERE tablename IN ('recipe_imports', 'recipe_import_items', 'ingredients')
                    AND indexname IN ('recipe_imports_user_created_idx', 'recipe_imports_updated_idx',
                                      'recipe_import_items_parse_job_idx',
                                      'recipe_import_items_recipe_idx', 'ingredients_import_line_idx')`,
            );
            const defs = result.rows.map((row: { indexdef: string }) => row.indexdef).join('\n');

            expect(result.rowCount).toBe(5);
            expect(defs).toMatch(/\(user_id, created_at\)/u);
            // The purge (ADR-0072 §11) finds imports idle for 30 days by this key, and must not scan every import.
            expect(defs).toMatch(/recipe_imports_updated_idx.*\(updated_at\)/su);
            expect(defs).toMatch(/UNIQUE INDEX recipe_import_items_parse_job_idx.*\(parse_job_id\).*WHERE/su);
            expect(defs).toMatch(/UNIQUE INDEX recipe_import_items_recipe_idx.*\(recipe_id\).*WHERE/su);
            expect(defs).toMatch(/ingredients_import_line_idx.*\(import_line_id\).*WHERE/su);
        });

        it('lets the SERVICE role insert, read, update and delete all three (default privileges; no GRANT in the SQL)', async () => {
            const importId = await newImport();

            await insert('recipe_import_items', receivedItem(importId, 0));
            await insert('recipe_import_lines', line(importId, 0));
            await pool.query(`UPDATE recipe_import_items SET review = 'reviewed' WHERE import_id = $1`, [importId]);

            expect(
                await count('SELECT count(*)::int AS n FROM recipe_import_lines WHERE import_id = $1', [importId]),
            ).toBe(1);
            expect((await pool.query('DELETE FROM recipe_imports WHERE id = $1', [importId])).rowCount).toBe(1);
        });
    });

    // ── the header ────────────────────────────────────────────────────────────────────────────────────────────────

    describe('recipe_imports', () => {
        it('starts the cursor at 0 and admits the three modes and both visibilities', async () => {
            for (const mode of ['keepAsWritten', 'bindBest', 'review']) {
                const row = await insert('recipe_imports', {
                    user_id: USER,
                    expected_total: 5,
                    match_mode: mode,
                    visibility: 'public',
                });

                expect(row['cursor_ordinal']).toBe(0);
            }
        });

        it.each([
            ['an invented match mode', { match_mode: 'guess' }],
            ['the snake_case spelling of a mode', { match_mode: 'keep_as_written' }],
            ['an invented visibility', { visibility: 'friends' }],
            ['a negative cursor', { cursor_ordinal: -1 }],
            ['a zero expected total', { expected_total: 0 }],
            ['a negative expected total', { expected_total: -3 }],
            ['a cursor past the end of the file', { expected_total: 5, cursor_ordinal: 6 }],
        ])('refuses %s', async (_name, extra) => {
            await refused(newImport(extra as Columns), CHECK_VIOLATION);
        });

        it('admits a cursor AT expected_total: that is the wizard being done', async () => {
            const row = await insert('recipe_imports', {
                user_id: USER,
                expected_total: 5,
                match_mode: 'review',
                visibility: 'private',
                cursor_ordinal: 5,
            });

            expect(row['cursor_ordinal']).toBe(5);
        });

        it('requires the owner, the mode and how many recipes the file holds', async () => {
            await refused(insert('recipe_imports', { match_mode: 'review', visibility: 'private' }), '23502');
            await refused(
                insert('recipe_imports', { user_id: USER, expected_total: 5, visibility: 'private' }),
                '23502',
            );
            await refused(
                insert('recipe_imports', { user_id: USER, match_mode: 'review', visibility: 'private' }),
                '23502',
            );
        });
    });

    // ── the items ─────────────────────────────────────────────────────────────────────────────────────────────────

    describe('recipe_import_items', () => {
        it('admits a received item and defaults its stage and review', async () => {
            const importId = await newImport();
            const row = await insert('recipe_import_items', receivedItem(importId, 0));

            expect(row).toMatchObject({ stage: 'received', review: 'pending', saved_at: null, recipe_id: null });
        });

        it.each([
            ['a blank title (a saved item whose draft was deleted still names itself)', { title: '   ' }],
            ['an empty title', { title: '' }],
            ['an invented stage', { stage: 'done' }],
            ['`ready` as a stage (readiness is computed, never stored)', { stage: 'ready' }],
            ['an invented review mark', { review: 'liked' }],
            ['an invented visibility', { visibility: 'friends' }],
            ['a payload that is not an object', { payload: JSON.stringify([1, 2]) }],
        ])('refuses %s', async (_name, extra) => {
            const importId = await newImport();

            await refused(insert('recipe_import_items', receivedItem(importId, 0, extra as Columns)), CHECK_VIOLATION);
        });

        it('requires a title: the list shows it without reading the payload, and it outlives the payload', async () => {
            const importId = await newImport();
            const { title: _title, ...withoutTitle } = receivedItem(importId, 0);

            await refused(insert('recipe_import_items', withoutTitle), '23502');
        });

        it('numbers the parse job generation from 0 and refuses a negative one', async () => {
            const importId = await newImport();
            const item = await insert('recipe_import_items', receivedItem(importId, 0));

            expect(item['parse_generation']).toBe(0);
            await expect(
                insert('recipe_import_items', receivedItem(importId, 1, { parse_generation: -1 })),
            ).rejects.toMatchObject({ code: CHECK_VIOLATION });
        });

        it('numbers the decision revision from 0 and refuses a negative one', async () => {
            const importId = await newImport();
            const item = await insert('recipe_import_items', receivedItem(importId, 0));

            expect(item['decision_rev']).toBe(0);
            await expect(
                insert('recipe_import_items', receivedItem(importId, 1, { decision_rev: -1 })),
            ).rejects.toMatchObject({ code: CHECK_VIOLATION });
        });

        it('refuses a negative ordinal', async () => {
            const importId = await newImport();

            await refused(insert('recipe_import_items', receivedItem(importId, -1)), CHECK_VIOLATION);
        });

        it('refuses two items with one ordinal in one import, and allows it across imports', async () => {
            const first = await newImport();
            const second = await newImport();

            await insert('recipe_import_items', receivedItem(first, 0));
            await refused(insert('recipe_import_items', receivedItem(first, 0)), UNIQUE_VIOLATION);
            await insert('recipe_import_items', receivedItem(second, 0));
        });

        describe('the stage facts are one fact each', () => {
            it('refuses a payload-less item that is not saved (before the save the server has nothing else)', async () => {
                const importId = await newImport();

                await refused(
                    insert('recipe_import_items', { import_id: importId, ordinal: 0, title: 'Soup' }),
                    CHECK_VIOLATION,
                );
            });

            it('refuses `saved` without saved_at, and saved_at without `saved`', async () => {
                const importId = await newImport();
                const matched = { allowance_spent_at: new Date(), matched_at: new Date(), statement_kind: 'authored' };

                await refused(
                    insert('recipe_import_items', receivedItem(importId, 0, { ...matched, stage: 'saved' })),
                    CHECK_VIOLATION,
                );
                await refused(
                    insert('recipe_import_items', receivedItem(importId, 1, { ...matched, saved_at: new Date() })),
                    CHECK_VIOLATION,
                );
            });

            it('admits a saved item with no payload, a statement and a recipe', async () => {
                const importId = await newImport();
                const row = await insert('recipe_import_items', {
                    import_id: importId,
                    ordinal: 0,
                    title: 'Soup',
                    stage: 'saved',
                    allowance_spent_at: new Date(),
                    matched_at: new Date(),
                    saved_at: new Date(),
                    statement_kind: 'authored',
                    recipe_id: RECIPE_A,
                });

                expect(row['payload']).toBeNull();
            });

            it('refuses matched_at without a matched or saved stage, and a matched stage without matched_at', async () => {
                const importId = await newImport();

                await refused(
                    insert('recipe_import_items', receivedItem(importId, 0, { matched_at: new Date() })),
                    CHECK_VIOLATION,
                );
                await refused(
                    insert('recipe_import_items', receivedItem(importId, 1, { stage: 'matched' })),
                    CHECK_VIOLATION,
                );
            });

            it('refuses a recipe on an item that was never saved', async () => {
                const importId = await newImport();

                await refused(
                    insert('recipe_import_items', receivedItem(importId, 0, { recipe_id: RECIPE_A })),
                    CHECK_VIOLATION,
                );
            });

            it('refuses a parse job on an item that never paid, and admits one that has', async () => {
                const importId = await newImport();

                await newJob(JOB_A);
                await refused(
                    insert('recipe_import_items', receivedItem(importId, 0, { parse_job_id: JOB_A })),
                    CHECK_VIOLATION,
                );
                await insert(
                    'recipe_import_items',
                    receivedItem(importId, 0, {
                        parse_job_id: JOB_A,
                        allowance_spent_at: new Date(),
                        stage: 'parsing',
                    }),
                );
            });

            it('refuses a saved item with no statement (the label is set from it)', async () => {
                const importId = await newImport();

                await refused(
                    insert('recipe_import_items', {
                        import_id: importId,
                        ordinal: 0,
                        title: 'Soup',
                        stage: 'saved',
                        allowance_spent_at: new Date(),
                        matched_at: new Date(),
                        saved_at: new Date(),
                    }),
                    CHECK_VIOLATION,
                );
            });
        });

        describe('the per-recipe statement (ADR-0072 §9)', () => {
            it.each([
                ['"I wrote this": no citation, no kind', { statement_kind: 'authored' }],
                [
                    'a public web page, with its URL',
                    { statement_kind: 'source', citation: 'https://example.test/soup', source_kind: 'public_web' },
                ],
                [
                    'a book, with a citation',
                    { statement_kind: 'source', citation: 'Joy of Cooking, p. 12', source_kind: 'book' },
                ],
                [
                    'a paid site, with a citation',
                    { statement_kind: 'source', citation: 'Paid Site, soup', source_kind: 'paid_site' },
                ],
                ['no statement yet', {}],
            ])('admits %s', async (_name, extra) => {
                const importId = await newImport();

                await insert('recipe_import_items', receivedItem(importId, 0, extra as Columns));
            });

            it.each([
                ['"I wrote this" carrying a citation', { statement_kind: 'authored', citation: 'x' }],
                ['"I wrote this" carrying a source kind', { statement_kind: 'authored', source_kind: 'book' }],
                ['"From a source" with no citation', { statement_kind: 'source', source_kind: 'book' }],
                ['"From a source" with no source kind', { statement_kind: 'source', citation: 'Joy of Cooking' }],
                ['a blank citation', { statement_kind: 'source', citation: '   ', source_kind: 'book' }],
                ['an empty citation', { statement_kind: 'source', citation: '', source_kind: 'book' }],
                [
                    'a citation over 2,000 characters',
                    { statement_kind: 'source', citation: 'x'.repeat(2001), source_kind: 'book' },
                ],
                ['an invented source kind', { statement_kind: 'source', citation: 'x', source_kind: 'blog' }],
                ['an invented statement kind', { statement_kind: 'maybe' }],
                ['a citation with no statement at all', { citation: 'x' }],
                ['a source kind with no statement at all', { source_kind: 'book' }],
            ])('refuses %s', async (_name, extra) => {
                const importId = await newImport();

                await refused(
                    insert('recipe_import_items', receivedItem(importId, 0, extra as Columns)),
                    CHECK_VIOLATION,
                );
            });
        });

        describe('one parse job per item and one item per recipe', () => {
            it('refuses a second item naming the same parse job', async () => {
                const importId = await newImport();

                await newJob(JOB_A);
                await insert('recipe_import_items', matchedItem(importId, 0, JOB_A));
                await refused(insert('recipe_import_items', matchedItem(importId, 1, JOB_A)), UNIQUE_VIOLATION);
            });

            it('allows any number of items with NO job (the unique index is partial)', async () => {
                const importId = await newImport();

                await insert('recipe_import_items', receivedItem(importId, 0));
                await insert('recipe_import_items', receivedItem(importId, 1));
                await insert('recipe_import_items', receivedItem(importId, 2));
            });

            it('refuses a second item naming the same recipe', async () => {
                const importId = await newImport();
                const saved = (ordinal: number): Columns => ({
                    import_id: importId,
                    ordinal,
                    title: 'Soup',
                    stage: 'saved',
                    allowance_spent_at: new Date(),
                    matched_at: new Date(),
                    saved_at: new Date(),
                    statement_kind: 'authored',
                    recipe_id: RECIPE_A,
                });

                await insert('recipe_import_items', saved(0));
                await refused(insert('recipe_import_items', saved(1)), UNIQUE_VIOLATION);
            });
        });

        describe('what the keys do when their parent goes', () => {
            it('⛔ a purged parse job leaves the item paid and stage-intact, with the job reference NULL', async () => {
                const importId = await newImport();

                await newJob(JOB_A);
                await insert('recipe_import_items', matchedItem(importId, 0, JOB_A));
                await pool.query('DELETE FROM recipe_parse_jobs WHERE id = $1', [JOB_A]);

                const { rows } = await pool.query(
                    'SELECT parse_job_id, allowance_spent_at, stage FROM recipe_import_items WHERE import_id = $1',
                    [importId],
                );

                expect(rows[0]).toMatchObject({ parse_job_id: null, stage: 'matched' });
                expect((rows[0] as { allowance_spent_at: Date | null }).allowance_spent_at).not.toBeNull();
            });

            it('⛔ the SNAPSHOT outlives its parse job: lines hold no key to the job tables', async () => {
                const importId = await newImport();

                await newJob(JOB_A);
                await insert('recipe_import_items', matchedItem(importId, 0, JOB_A));
                await insert('recipe_import_lines', line(importId, 0, proposed()));
                await pool.query('DELETE FROM recipe_parse_jobs WHERE id = $1', [JOB_A]);

                expect(
                    await count('SELECT count(*)::int AS n FROM recipe_import_lines WHERE import_id = $1', [importId]),
                ).toBe(1);

                const keys = await pool.query(
                    `SELECT confrelid::regclass::text AS parent FROM pg_constraint
                      WHERE conrelid = 'recipe_import_lines'::regclass AND contype = 'f'`,
                );

                expect(keys.rows.map((row: { parent: string }) => row.parent)).toEqual(['recipe_import_items']);
            });

            it('⛔ a deleted draft leaves the item SAVED, with the recipe reference NULL', async () => {
                const importId = await newImport();

                await insert('recipe_import_items', {
                    import_id: importId,
                    ordinal: 0,
                    title: 'Soup',
                    stage: 'saved',
                    allowance_spent_at: new Date(),
                    matched_at: new Date(),
                    saved_at: new Date(),
                    statement_kind: 'authored',
                    recipe_id: RECIPE_B,
                });
                await pool.query('DELETE FROM recipes WHERE id = $1', [RECIPE_B]);

                const { rows } = await pool.query(
                    'SELECT recipe_id, saved_at, stage FROM recipe_import_items WHERE import_id = $1',
                    [importId],
                );

                expect(rows[0]).toMatchObject({ recipe_id: null, stage: 'saved' });
                expect((rows[0] as { saved_at: Date | null }).saved_at).not.toBeNull();

                // Put the probe recipe back for the suites that follow.
                await pool.query(
                    `INSERT INTO recipes (id, owner_id, title, description, prep_time_minutes, cook_time_minutes,
                                          total_time_minutes, servings, visibility, source_type, status)
                     VALUES ($1, $2, 'import schema probe', '', 1, 1, 2, 1, 'private', 'user_created', 'draft')`,
                    [RECIPE_B, USER],
                );
            });

            it('deleting the header deletes its items and lines', async () => {
                const importId = await newImport();

                await insert('recipe_import_items', receivedItem(importId, 0));
                await insert('recipe_import_lines', line(importId, 0));
                await pool.query('DELETE FROM recipe_imports WHERE id = $1', [importId]);

                expect(
                    await count('SELECT count(*)::int AS n FROM recipe_import_items WHERE import_id = $1', [importId]),
                ).toBe(0);
                expect(
                    await count('SELECT count(*)::int AS n FROM recipe_import_lines WHERE import_id = $1', [importId]),
                ).toBe(0);
            });

            it("deleting one item deletes its lines and no other item's", async () => {
                const importId = await newImport();

                await insert('recipe_import_items', receivedItem(importId, 0));
                await insert('recipe_import_items', receivedItem(importId, 1));
                await insert('recipe_import_lines', line(importId, 0));
                await insert('recipe_import_lines', line(importId, 1));
                await pool.query('DELETE FROM recipe_import_items WHERE import_id = $1 AND ordinal = 0', [importId]);

                const left = await pool.query('SELECT ordinal FROM recipe_import_lines WHERE import_id = $1', [
                    importId,
                ]);

                expect(left.rows).toEqual([{ ordinal: 1 }]);
            });

            it('a line cannot name an item that does not exist', async () => {
                const importId = await newImport();

                await refused(insert('recipe_import_lines', line(importId, 9)), '23503');
            });
        });
    });

    // ── the snapshot lines ────────────────────────────────────────────────────────────────────────────────────────

    describe('recipe_import_lines', () => {
        async function withItem(): Promise<string> {
            const importId = await newImport();

            await insert('recipe_import_items', receivedItem(importId, 0));

            return importId;
        }

        it('admits a line that proposed a food, a variant, and a line that found nothing', async () => {
            const importId = await withItem();

            await insert('recipe_import_lines', line(importId, 0, proposed()));
            await insert(
                'recipe_import_lines',
                line(importId, 0, {
                    food_index: 1,
                    matched_by: 'curated',
                    food_variant_id: 'variant-1',
                    review: 'refused',
                }),
            );
            await insert('recipe_import_lines', line(importId, 0, { line_index: 1 }));
        });

        it('keeps a candidate list of ids, isDefault and rung, without names', async () => {
            const importId = await withItem();
            const candidates = [{ kind: 'root', id: 'food-2', rung: 'exact', isDefault: true }];
            const row = await insert(
                'recipe_import_lines',
                line(importId, 0, { candidates: JSON.stringify(candidates) }),
            );

            expect(row['candidates']).toEqual(candidates);
        });

        it('refuses the same (item, line, food) twice', async () => {
            const importId = await withItem();

            await insert('recipe_import_lines', line(importId, 0));
            await refused(insert('recipe_import_lines', line(importId, 0)), UNIQUE_VIOLATION);
        });

        it.each([
            ['both a food and a variant', proposed({ food_variant_id: 'v-1' })],
            ['a tier with no food', { matched_by: 'lexical', review: null, verification_key: null }],
            ['a food with no tier', proposed({ matched_by: null })],
            ['an invented tier', proposed({ matched_by: 'guess' })],
            ['a food with no review', proposed({ review: null, verification_key: null })],
            ['a review with no food', { review: 'refused' }],
            ['a verification key with no food', { verification_key: 'vk' }],
            ['an owed review with no key', proposed({ verification_key: null })],
            ['a key on a refused review', proposed({ review: 'refused' })],
            ['an invented review value', proposed({ review: 'budgetSpent', verification_key: null })],
            ['more than five candidates', { candidates: JSON.stringify([1, 2, 3, 4, 5, 6].map((id) => ({ id }))) }],
            ['candidates that are not an array', { candidates: JSON.stringify({ id: 1 }) }],
            ['a negative line index', { line_index: -1 }],
            ['a negative food index', { food_index: -1 }],
        ])('refuses %s', async (_name, extra) => {
            const importId = await withItem();

            await refused(insert('recipe_import_lines', line(importId, 0, extra as Columns)), CHECK_VIOLATION);
        });

        describe("the cook's pick", () => {
            it.each([
                ['a food', { picked_food_id: 'food-9', picked_against_digest: 'jd' }],
                ['a variant', { picked_food_variant_id: 'v-9', picked_against_digest: 'jd' }],
                ['"keep as written"', { picked_as_written: true, picked_against_digest: 'jd' }],
                ['nothing', {}],
            ])('admits %s', async (_name, extra) => {
                const importId = await withItem();

                await insert('recipe_import_lines', line(importId, 0, extra as Columns));
            });

            it.each([
                [
                    'a food and a variant',
                    { picked_food_id: 'f', picked_food_variant_id: 'v', picked_against_digest: 'jd' },
                ],
                [
                    'a food and "as written"',
                    { picked_food_id: 'f', picked_as_written: true, picked_against_digest: 'jd' },
                ],
                ['a pick with no digest', { picked_food_id: 'f' }],
                ['"as written" with no digest', { picked_as_written: true }],
                ['a digest with no pick', { picked_against_digest: 'jd' }],
            ])('refuses %s', async (_name, extra) => {
                const importId = await withItem();

                await refused(insert('recipe_import_lines', line(importId, 0, extra as Columns)), CHECK_VIOLATION);
            });
        });

        describe("the measure mirrors the ingredient's (0051)", () => {
            it('stores an exact quantity, a range, and the unit the source printed', async () => {
                const importId = await withItem();
                const row = await insert(
                    'recipe_import_lines',
                    line(importId, 0, {
                        quantity: '1.5',
                        quantity_high: '2',
                        unit: 'cup',
                        stated_quantity: '3',
                        stated_quantity_high: '4',
                        stated_unit: 'gill',
                    }),
                );

                expect(row).toMatchObject({
                    quantity: '1.500',
                    quantity_high: '2.000',
                    stated_unit: 'gill',
                    unit: 'cup',
                });
            });

            it('admits NO amount (NULL is the one spelling of "the source stated none") and a unitless line', async () => {
                const importId = await withItem();
                const row = await insert('recipe_import_lines', line(importId, 0, { unit: '' }));

                expect(row).toMatchObject({ quantity: null, unit: '' });
            });

            it.each([
                ['a zero amount', { quantity: 0 }],
                ['an upper bound with no lower', { quantity_high: 2 }],
                ['an upper bound at the lower', { quantity: 2, quantity_high: 2 }],
                ['half a restatement', { quantity: 1, stated_quantity: 2 }],
                ['a restatement with a blank unit', { quantity: 1, stated_quantity: 2, stated_unit: '' }],
                ['a restatement with no restated amount', { stated_unit: 'gill' }],
                ['a restatement on an absent quantity', { stated_quantity: 2, stated_unit: 'gill' }],
                [
                    'an inverted stated range',
                    { quantity: 1, stated_quantity: 4, stated_quantity_high: 3, stated_unit: 'gill' },
                ],
                ['a blank preparation', { preparation: '  ' }],
                ['a blank source line', { source_line: '  ' }],
            ])('refuses %s', async (_name, extra) => {
                const importId = await withItem();

                await refused(insert('recipe_import_lines', line(importId, 0, extra as Columns)), CHECK_VIOLATION);
            });

            it('requires the source line, the unit and the digests', async () => {
                const importId = await withItem();
                const { source_line: _line, ...withoutLine } = line(importId, 0);

                await refused(insert('recipe_import_lines', withoutLine), '23502');
            });

            it('requires the unit (a line has one; unitless is the empty string)', async () => {
                const importId = await withItem();
                const { unit: _unit, ...withoutUnit } = line(importId, 0);

                await refused(insert('recipe_import_lines', withoutUnit), '23502');
            });
        });
    });

    // ── the ingredient columns (0060) ─────────────────────────────────────────────────────────────────────────────

    describe('ingredients.bound_by and import_line_id', () => {
        const insertIngredient = async (columns: Columns, recipeId = RECIPE_A): Promise<Record<string, unknown>> =>
            insert('ingredients', {
                recipe_id: recipeId,
                food_lookup_id: LOOKUP,
                unit: 'cup',
                quantity: 1,
                ...columns,
            });

        it.each(['exact', 'curated', 'review', 'default', 'autoBest', 'cook'])(
            'accepts the origin %s',
            async (boundBy) => {
                const row = await insertIngredient({ bound_by: boundBy });

                expect(row['bound_by']).toBe(boundBy);
            },
        );

        it('accepts NULL (no recorded origin)', async () => {
            expect((await insertIngredient({}))['bound_by']).toBeNull();
        });

        it.each(['migration', 'Exact', 'auto_best', 'autobest', '', 'user'])(
            'refuses the origin %j',
            async (boundBy) => {
                await refused(insertIngredient({ bound_by: boundBy }), CHECK_VIOLATION);
            },
        );

        it('refuses an import_line_id that names no line (the key is real)', async () => {
            await refused(insertIngredient({ import_line_id: '66666666-6666-4666-8666-0000000000ff' }), '23503');
        });

        it('⛔ deleting the import leaves the recipe and its ingredient, with import_line_id NULL and bound_by kept', async () => {
            const importId = await newImport();

            await insert('recipe_import_items', receivedItem(importId, 0));

            const snapshot = await insert('recipe_import_lines', line(importId, 0, proposed()));
            const ingredient = await insertIngredient({ bound_by: 'review', import_line_id: snapshot['id'] });

            await pool.query('DELETE FROM recipe_imports WHERE id = $1', [importId]);

            const { rows } = await pool.query('SELECT bound_by, import_line_id FROM ingredients WHERE id = $1', [
                ingredient['id'],
            ]);

            expect(rows).toEqual([{ bound_by: 'review', import_line_id: null }]);
            expect(await count('SELECT count(*)::int AS n FROM recipes WHERE id = $1', [RECIPE_A])).toBe(1);
        });
    });
});
