/**
 * THE BULK-IMPORT DALs against a REAL migrated PostgreSQL (LOCAL e2e, `docs/CODING_STANDARDS.md` §7.1a), connected as the
 * SERVICE role. Every claim here is about the database, and a mocked DAL can observe none of them. What each group is there to
 * catch:
 *
 *  - **The header**: ownership is in the WHERE (a stranger reads, lists and deletes nothing); creating an id twice is
 *    idempotent for its owner and `foreign` for anyone else (never a leak that the id exists); the cursor move is a
 *    compare-and-swap (`WHERE cursor_ordinal = from`), so of two devices racing from the same position exactly one moves.
 *  - **The items**: a request is all or nothing (one locked item rolls the whole chunk back); a replay of the same recipe is
 *    a no-op; absent keeps the statement and visibility, present replaces them.
 *  - **Paying**: the unit is spent under the per-user lock and ONLY for the items it names, so two concurrent calls never pay
 *    one item twice and never spend past the limit (kills: removing the row lock, or paying by the request instead of by the
 *    admitted units).
 *  - **The save claim**: `saved_at IS NULL` in the recipe's own transaction; a second claim finds zero rows and throws.
 *  - **The lines**: a pick applies only against the digest the cook saw; the “to check” list and count are exactly the lines
 *    saved as written that no one has picked, owned by the caller, whose recipe still exists.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { createRecipeDrizzle, type RecipeDrizzle } from '../../../src/database/client.js';
import { RecipeImportItemsDal } from '../../../src/import/dal/recipeImportItems.dal.js';
import { RecipeImportLinesDal } from '../../../src/import/dal/recipeImportLines.dal.js';
import { RecipeImportsDal } from '../../../src/import/dal/recipeImports.dal.js';
import { ImportAllowanceDal } from '../../../src/common/dal/importAllowance.dal.js';
import { ensureFoodLookup } from '../../support/lineChain.js';
import { recipeDb } from '../../support/roleDb.js';

const roleDb = recipeDb();

const USER = '01JIMPORTDALE2E000000001';
const OTHER = '01JIMPORTDALE2E000000002';
const RECIPE_ID = '77777777-7777-4777-8777-000000000a01';
const LOOKUP = '77777777-7777-4777-8777-000000000a03';
const FOOD_ID = '01JIMPORTDALE2E0000000FOOD';

/** A pick recorded AFTER the rebind of a saved draft: the item is already saved, so there is nothing to fence. */
const AFTER_REBIND = { onlyUnsaved: false } as const;
/** A pick on an item that is not saved yet: it must be fenced against a racing save. */
const BEFORE_SAVE = { onlyUnsaved: true } as const;

const recipe = (title: string, lines = ['2 cups flour']) => ({
    title,
    ingredientLines: lines,
    steps: [{ instruction: 'Mix.' }],
});

describe('the bulk-import DALs (LOCAL e2e, real Postgres)', () => {
    let pool: pg.Pool;
    let db: RecipeDrizzle;
    let imports: RecipeImportsDal;
    let items: RecipeImportItemsDal;
    let lines: RecipeImportLinesDal;

    beforeAll(async () => {
        pool = new pg.Pool({ connectionString: roleDb.appUrl, max: 8 });
        db = createRecipeDrizzle(pool);
        imports = new RecipeImportsDal(db);
        items = new RecipeImportItemsDal(db, new ImportAllowanceDal());
        lines = new RecipeImportLinesDal(db);

        await ensureFoodLookup(pool, { arm: 'shared', foodId: FOOD_ID, id: LOOKUP });
        await pool.query(
            `INSERT INTO recipes (id, owner_id, title, description, prep_time_minutes, cook_time_minutes,
                                  total_time_minutes, servings, visibility, source_type, status)
             VALUES ($1, $2, 'dal probe', '', 1, 1, 2, 1, 'private', 'user_created', 'draft') ON CONFLICT (id) DO NOTHING`,
            [RECIPE_ID, USER],
        );
    });

    afterEach(async () => {
        await pool.query('DELETE FROM recipe_imports WHERE user_id = ANY($1)', [[USER, OTHER]]);
        await pool.query('DELETE FROM import_allowance_events WHERE user_id = ANY($1)', [[USER, OTHER]]);
        await pool.query('DELETE FROM ingredients WHERE recipe_id = $1', [RECIPE_ID]);
        await pool.query('UPDATE recipes SET deleted_at = NULL WHERE id = $1', [RECIPE_ID]);
    });

    afterAll(async () => {
        await pool.query('DELETE FROM recipes WHERE id = $1', [RECIPE_ID]);
        await pool.query('DELETE FROM food_lookups WHERE id = $1', [LOOKUP]);
        await pool.end();
    });

    async function newImport(expectedTotal = 5, userId = USER, id?: string) {
        const result = await imports.insertHeader(userId, {
            id: id ?? crypto.randomUUID(),
            matchMode: 'keepAsWritten',
            visibility: 'private',
            expectedTotal,
        });

        if (result.kind === 'foreign') {
            throw new Error('unexpected foreign');
        }

        return result.header;
    }

    async function put(importId: string, ordinals: readonly number[], extra: object = {}) {
        return items.upsertItems(
            importId,
            ordinals.map((ordinal) => ({ ordinal, recipe: recipe(`Recipe ${String(ordinal)}`), ...extra })),
        );
    }

    // ── the header ────────────────────────────────────────────────────────────────────────────────────────────────

    describe('RecipeImportsDal', () => {
        it('creates a header once; the same id for its owner is `existing`, for anyone else `foreign`', async () => {
            const id = crypto.randomUUID();
            const first = await imports.insertHeader(USER, {
                id,
                matchMode: 'review',
                visibility: 'public',
                expectedTotal: 9,
            });
            const again = await imports.insertHeader(USER, {
                id,
                matchMode: 'review',
                visibility: 'public',
                expectedTotal: 9,
            });
            const stranger = await imports.insertHeader(OTHER, {
                id,
                matchMode: 'review',
                visibility: 'public',
                expectedTotal: 9,
            });

            expect(first).toMatchObject({
                kind: 'created',
                header: { id, userId: USER, matchMode: 'review', expectedTotal: 9, cursorOrdinal: 0 },
            });
            expect(again).toMatchObject({ kind: 'existing', header: { id, userId: USER } });
            expect(stranger).toEqual({ kind: 'foreign' });
            expect((await pool.query('SELECT 1 FROM recipe_imports WHERE id = $1', [id])).rowCount).toBe(1);
        });

        it('⛔ reads, lists and deletes only the caller’s imports (the owner is in the WHERE)', async () => {
            const mine = await newImport();
            const theirs = await newImport(5, OTHER);

            expect(await imports.findHeader(USER, mine.id)).toMatchObject({ id: mine.id });
            expect(await imports.findHeader(USER, theirs.id)).toBeUndefined();
            expect((await imports.listHeaders(USER, undefined, 10)).map((header) => header.id)).toEqual([mine.id]);
            expect(await imports.deleteHeader(USER, theirs.id)).toBe(false);
            expect(await imports.findHeader(OTHER, theirs.id)).toBeDefined();
            expect(await imports.deleteHeader(USER, mine.id)).toBe(true);
            expect(await imports.findHeader(USER, mine.id)).toBeUndefined();
        });

        it('lists newest first and pages by a keyset (no skipped or repeated import)', async () => {
            const made = [];

            for (let index = 0; index < 5; index += 1) {
                made.push(await newImport());
                await new Promise((resolve) => setTimeout(resolve, 5));
            }

            const first = await imports.listHeaders(USER, undefined, 2);
            const last = first.at(-1);
            const second = await imports.listHeaders(
                USER,
                last === undefined ? undefined : { createdAt: last.createdAtIso, id: last.id },
                2,
            );

            expect(first.map((header) => header.id)).toEqual([made[4]?.id, made[3]?.id]);
            expect(second.map((header) => header.id)).toEqual([made[2]?.id, made[1]?.id]);
        });

        it('deleting an import deletes its items and lines and leaves the recipe it saved', async () => {
            const header = await newImport(1);

            await put(header.id, [0]);
            await pool.query(`UPDATE ingredients SET import_line_id = NULL WHERE recipe_id = $1`, [RECIPE_ID]);
            await imports.deleteHeader(USER, header.id);

            expect(
                (await pool.query('SELECT 1 FROM recipe_import_items WHERE import_id = $1', [header.id])).rowCount,
            ).toBe(0);
            expect((await pool.query('SELECT 1 FROM recipes WHERE id = $1', [RECIPE_ID])).rowCount).toBe(1);
        });

        describe('moveCursor', () => {
            it('moves and marks the left item in one step, bumping the activity clock', async () => {
                const header = await newImport(3);

                await put(header.id, [0, 1, 2]);

                const result = await imports.moveCursor(USER, header.id, {
                    from: 0,
                    to: 1,
                    mark: { ordinal: 0, review: 'reviewed' },
                });
                const after = await imports.findHeader(USER, header.id);
                const item = await items.findItem(header.id, 0);

                expect(result).toEqual({ kind: 'moved' });
                expect(after?.cursorOrdinal).toBe(1);
                expect(after?.updatedAt.getTime()).toBeGreaterThan(header.updatedAt.getTime());
                expect(item?.review).toBe('reviewed');
            });

            it('⛔ refuses a move from a stale position, says where the cursor is, and changes nothing', async () => {
                const header = await newImport(3);

                await put(header.id, [0, 1, 2]);
                await imports.moveCursor(USER, header.id, { from: 0, to: 1 });

                const result = await imports.moveCursor(USER, header.id, {
                    from: 0,
                    to: 2,
                    mark: { ordinal: 0, review: 'skipped' },
                });

                expect(result).toEqual({ kind: 'conflict', cursorOrdinal: 1 });
                expect((await items.findItem(header.id, 0))?.review).toBe('pending');
            });

            it('⛔ of two devices racing from one position exactly one moves', async () => {
                const header = await newImport(4);

                await put(header.id, [0, 1, 2, 3]);

                const results = await Promise.all([
                    imports.moveCursor(USER, header.id, { from: 0, to: 1, mark: { ordinal: 0, review: 'reviewed' } }),
                    imports.moveCursor(USER, header.id, { from: 0, to: 2, mark: { ordinal: 0, review: 'skipped' } }),
                ]);

                expect(results.filter((result) => result.kind === 'moved')).toHaveLength(1);
                expect(results.filter((result) => result.kind === 'conflict')).toHaveLength(1);
            });

            it('is missing for a stranger’s import', async () => {
                const theirs = await newImport(3, OTHER);

                expect(await imports.moveCursor(USER, theirs.id, { from: 0, to: 1 })).toEqual({ kind: 'missing' });
            });

            it('can move to done (the count itself)', async () => {
                const header = await newImport(2);

                expect(await imports.moveCursor(USER, header.id, { from: 0, to: 2 })).toEqual({ kind: 'moved' });
                expect((await imports.findHeader(USER, header.id))?.cursorOrdinal).toBe(2);
            });
        });

        it('closeReview records Save and leave once and keeps the first time', async () => {
            const header = await newImport();

            expect(await imports.closeReview(USER, header.id)).toBe(true);

            const first = (await imports.findHeader(USER, header.id))?.reviewClosedAt;

            await new Promise((resolve) => setTimeout(resolve, 5));
            expect(await imports.closeReview(USER, header.id)).toBe(true);
            expect((await imports.findHeader(USER, header.id))?.reviewClosedAt).toEqual(first);
            expect(await imports.closeReview(USER, crypto.randomUUID())).toBe(false);
        });

        it('touch moves only the activity clock', async () => {
            const header = await newImport();

            await new Promise((resolve) => setTimeout(resolve, 5));
            await imports.touch(header.id);

            const after = await imports.findHeader(USER, header.id);

            expect(after?.updatedAt.getTime()).toBeGreaterThan(header.updatedAt.getTime());
            expect(after?.cursorOrdinal).toBe(header.cursorOrdinal);
        });

        it('counts the arrived items by stage', async () => {
            const header = await newImport(6);

            await put(header.id, [0, 1, 2, 3]);
            await pool.query(
                `UPDATE recipe_import_items SET stage = 'parsing', allowance_spent_at = now() WHERE import_id = $1 AND ordinal = 1`,
                [header.id],
            );

            expect(await imports.countsByStage(header.id)).toEqual({
                total: 4,
                received: 3,
                parsing: 1,
                matched: 0,
                saved: 0,
                refused: 0,
            });
        });

        it('⛔ counts a refused item in `total` and in `refused`, and NOT in `received`', async () => {
            const header = await newImport(4);

            await items.upsertItems(header.id, [
                { ordinal: 0, recipe: recipe('fine') },
                { ordinal: 1, recipe: recipe('no lines', []) },
                { ordinal: 2, recipe: { ...recipe('no steps'), steps: [] } },
                { ordinal: 3, recipe: recipe('also fine') },
            ]);

            expect(await imports.countsByStage(header.id)).toEqual({
                total: 4,
                received: 2,
                parsing: 0,
                matched: 0,
                saved: 0,
                refused: 2,
            });
        });

        it('counts the unsaved items that would be private, per the item’s own choice over the import’s', async () => {
            const header = await newImport(3); // the import asks for private

            await put(header.id, [0, 1, 2]);
            await items.recordChoices(header.id, 1, { visibility: 'public' });

            expect(await imports.countUnsavedPrivate(header.id)).toBe(2);
        });

        it('⛔ fingerprints the verdicts on the lines’ keys, by EITHER key the line holds', async () => {
            const header = await newImport(1);

            await put(header.id, [0]);
            await pool.query(
                `INSERT INTO recipe_import_lines (import_id, ordinal, line_index, food_index, source_line, line_digest, judgement_digest, phrase, name, unit, food_id, matched_by, review, verification_key, saved_verification_key)
                 VALUES ($1, 0, 0, 0, 'l', 'ld', 'jd', 'p', 'p', '', 'f1', 'lexical', 'owed', 'v1:imp-proposal', 'v1:imp-saved')`,
                [header.id],
            );

            expect(await imports.verdictFingerprint(header.id)).toEqual({ count: 0, latest: null });

            for (const key of ['v1:imp-proposal', 'v1:imp-saved']) {
                await roleDb.asOwner(async (owner) => {
                    await owner.query(
                        `INSERT INTO recipe_ingredient_verifications (verification_key, verdict, certainty, band, aspects, model_id, food_id)
                         VALUES ($1, 'agree', 'high', 'verified', ARRAY['identity'], 'm', 'f1') ON CONFLICT DO NOTHING`,
                        [key],
                    );
                });
            }

            const fingerprint = await imports.verdictFingerprint(header.id);

            expect(fingerprint.count).toBe(2);
            expect(fingerprint.latest).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/u);
            await roleDb.asOwner(async (owner) => {
                await owner.query(`DELETE FROM recipe_ingredient_verifications WHERE verification_key = ANY($1)`, [
                    [`v1:imp-proposal`, `v1:imp-saved`],
                ]);
            });
        });
    });

    // ── the items ─────────────────────────────────────────────────────────────────────────────────────────────────

    describe('RecipeImportItemsDal.upsertItems', () => {
        it('inserts new items as received with the title beside the payload', async () => {
            const header = await newImport();

            expect(await put(header.id, [0, 1])).toEqual({ kind: 'ok' });

            const row = await items.findItem(header.id, 1);

            expect(row).toMatchObject({
                ordinal: 1,
                title: 'Recipe 1',
                stage: 'received',
                review: 'pending',
                payload: recipe('Recipe 1'),
            });
        });

        it('a replay of the same recipe changes nothing', async () => {
            const header = await newImport();

            await put(header.id, [0]);

            const before = await items.findItem(header.id, 0);

            expect(await put(header.id, [0])).toEqual({ kind: 'ok' });
            expect(await items.findItem(header.id, 0)).toEqual(before);
        });

        it('replaces a different recipe while the item is still received', async () => {
            const header = await newImport();

            await put(header.id, [0]);
            await items.upsertItems(header.id, [{ ordinal: 0, recipe: recipe('Fixed title', ['3 eggs']) }]);

            expect(await items.findItem(header.id, 0)).toMatchObject({
                title: 'Fixed title',
                payload: recipe('Fixed title', ['3 eggs']),
            });
        });

        /**
         * Review finding 4 on #185-#188. An item's parse job id is derived from (import, ordinal, parse_generation). A paid item
         * whose job was created just before a crash is still `received`, so a different recipe may replace it; without a new
         * generation the next advance derives the SAME id and is handed the old job, built from the old text.
         */
        it('⛔ moves the parse generation when it replaces a recipe, so the next parse job is a new one; a replay does not', async () => {
            const header = await newImport();

            await put(header.id, [0]);
            await items.upsertItems(header.id, [{ ordinal: 0, recipe: recipe('Fixed title', ['3 eggs']) }]);

            expect((await items.findItem(header.id, 0))?.parseGeneration).toBe(1);

            await items.upsertItems(header.id, [{ ordinal: 0, recipe: recipe('Fixed title', ['3 eggs']) }]);

            expect((await items.findItem(header.id, 0))?.parseGeneration).toBe(1);
        });

        it('⛔ LOCKS a different recipe once the item is past received, and the WHOLE request rolls back', async () => {
            const header = await newImport();

            await put(header.id, [0]);
            await pool.query(
                `UPDATE recipe_import_items SET stage = 'parsing', allowance_spent_at = now() WHERE import_id = $1 AND ordinal = 0`,
                [header.id],
            );

            const result = await items.upsertItems(header.id, [
                { ordinal: 1, recipe: recipe('Fresh') },
                { ordinal: 0, recipe: recipe('Changed', ['5 eggs']) },
            ]);

            expect(result).toEqual({ kind: 'locked', ordinal: 0, stage: 'parsing' });
            expect(await items.findItem(header.id, 1)).toBeUndefined();
            expect((await items.findItem(header.id, 0))?.title).toBe('Recipe 0');
        });

        it('⛔ refuses a saved item, whatever the recipe, and writes nothing else of the request', async () => {
            const header = await newImport();

            await put(header.id, [0]);
            await pool.query(
                `UPDATE recipe_import_items SET stage = 'saved', saved_at = now(), matched_at = now(), allowance_spent_at = now(), payload = NULL,
                        statement_kind = 'authored' WHERE import_id = $1 AND ordinal = 0`,
                [header.id],
            );

            const result = await items.upsertItems(header.id, [
                { ordinal: 1, recipe: recipe('Fresh') },
                { ordinal: 0, recipe: recipe('Recipe 0') },
            ]);

            expect(result).toEqual({ kind: 'saved', ordinal: 0 });
            expect(await items.findItem(header.id, 1)).toBeUndefined();
        });

        it('ABSENT statement and visibility keep what the item holds; PRESENT replaces them', async () => {
            const header = await newImport();

            await items.upsertItems(header.id, [
                {
                    ordinal: 0,
                    recipe: recipe('Recipe 0'),
                    statement: { kind: 'book', citation: 'Joy, p. 12' },
                    visibility: 'private',
                },
            ]);
            await put(header.id, [0]);

            expect(await items.findItem(header.id, 0)).toMatchObject({
                statementKind: 'source',
                sourceKind: 'book',
                citation: 'Joy, p. 12',
                visibility: 'private',
            });

            await items.upsertItems(header.id, [
                { ordinal: 0, recipe: recipe('Recipe 0'), statement: { kind: 'authored' } },
            ]);

            expect(await items.findItem(header.id, 0)).toMatchObject({
                statementKind: 'authored',
                sourceKind: null,
                citation: null,
                visibility: 'private',
            });
        });

        it('bumps the import’s activity clock', async () => {
            const header = await newImport();

            await new Promise((resolve) => setTimeout(resolve, 5));
            await put(header.id, [0]);

            expect((await imports.findHeader(USER, header.id))?.updatedAt.getTime()).toBeGreaterThan(
                header.updatedAt.getTime(),
            );
        });

        it('pages the items by ordinal and leaves the payload out of the page', async () => {
            const header = await newImport(5);

            await put(header.id, [0, 1, 2, 3, 4]);

            const page = await items.findPage(header.id, 1, 2);

            expect(page.map((item) => item.ordinal)).toEqual([2, 3]);
            expect(page.every((item) => item.payload === null)).toBe(true);
        });

        it('⛔ reads what the save needs from the payload in SQL, so the list can name the gap without the document', async () => {
            const header = await newImport(3);

            await items.upsertItems(header.id, [
                {
                    ordinal: 0,
                    recipe: {
                        ...recipe('Stated', ['1 egg', '2 cups flour']),
                        cuisine: 'French',
                        servings: 4,
                        prepTimeMinutes: 0,
                        cookTimeMinutes: 25,
                        totalTimeMinutes: 30,
                    },
                },
                { ordinal: 1, recipe: { ...recipe('Bare', []), steps: [] } },
            ]);

            const page = await items.findPage(header.id, undefined, 5);

            expect(page.map((item) => item.saveFacts)).toEqual([
                {
                    file: {
                        cuisine: 'French',
                        servings: 4,
                        prepTimeMinutes: 0,
                        cookTimeMinutes: 25,
                        totalTimeMinutes: 30,
                    },
                    ingredientLineCount: 2,
                    stepCount: 1,
                },
                {
                    file: {
                        cuisine: null,
                        servings: null,
                        prepTimeMinutes: null,
                        cookTimeMinutes: null,
                        totalTimeMinutes: null,
                    },
                    ingredientLineCount: 0,
                    stepCount: 0,
                },
            ]);
            expect(page.map((item) => item.refusal)).toEqual([null, 'noIngredients']);
        });
    });

    describe('⛔ a refused recipe (no ingredient line or no step; ADR-0072 §3, owner ruling 2026-11-11)', () => {
        const noSteps = (title: string) => ({ ...recipe(title), steps: [] });

        it('stores the refusal at write time: noIngredients, noSteps, and none for a whole recipe', async () => {
            const header = await newImport(4);

            await items.upsertItems(header.id, [
                { ordinal: 0, recipe: recipe('whole') },
                { ordinal: 1, recipe: recipe('empty', []) },
                { ordinal: 2, recipe: noSteps('stepless') },
                { ordinal: 3, recipe: { ...noSteps('bare'), ingredientLines: [] } },
            ]);

            expect((await items.findItem(header.id, 0))?.refusal).toBeNull();
            expect((await items.findItem(header.id, 1))?.refusal).toBe('noIngredients');
            expect((await items.findItem(header.id, 2))?.refusal).toBe('noSteps');
            // Both are missing: the first in the publish order wins.
            expect((await items.findItem(header.id, 3))?.refusal).toBe('noIngredients');
        });

        it('a replace with a fixed recipe CLEARS the refusal, and a replace with an empty one sets it, even on a paid item', async () => {
            const header = await newImport(1);

            await items.upsertItems(header.id, [{ ordinal: 0, recipe: recipe('empty', []) }]);
            expect((await items.findItem(header.id, 0))?.refusal).toBe('noIngredients');

            await items.upsertItems(header.id, [{ ordinal: 0, recipe: recipe('fixed') }]);
            expect((await items.findItem(header.id, 0))?.refusal).toBeNull();

            await pool.query(
                `UPDATE recipe_import_items SET allowance_spent_at = now() WHERE import_id = $1 AND ordinal = 0`,
                [header.id],
            );
            await items.upsertItems(header.id, [{ ordinal: 0, recipe: noSteps('emptied') }]);
            expect(await items.findItem(header.id, 0)).toMatchObject({ refusal: 'noSteps', stage: 'received' });
        });

        it('a replay of the same refused recipe leaves its refusal as it was', async () => {
            const header = await newImport(1);

            await items.upsertItems(header.id, [{ ordinal: 0, recipe: recipe('empty', []) }]);
            await items.upsertItems(header.id, [{ ordinal: 0, recipe: recipe('empty', []) }]);

            expect((await items.findItem(header.id, 0))?.refusal).toBe('noIngredients');
        });

        it('⛔ payUnpaid never pays for a refused item: only the whole recipes spend a unit', async () => {
            const header = await newImport(3);

            await items.upsertItems(header.id, [
                { ordinal: 0, recipe: recipe('empty', []) },
                { ordinal: 1, recipe: recipe('whole') },
                { ordinal: 2, recipe: noSteps('stepless') },
            ]);

            expect(await items.payUnpaid(USER, header.id, { limit: 10, isPremium: true })).toEqual({
                kind: 'paid',
                ordinals: [1],
            });
            expect((await items.findItem(header.id, 0))?.allowanceSpentAt).toBeNull();
            expect((await items.findItem(header.id, 2))?.allowanceSpentAt).toBeNull();
        });

        it('⛔ a refused item is never listed for a job, so it never reaches parsing or a match', async () => {
            const header = await newImport(2);

            await items.upsertItems(header.id, [
                { ordinal: 0, recipe: recipe('empty', []) },
                { ordinal: 1, recipe: noSteps('stepless') },
            ]);

            expect(await items.findNeedingJob(header.id, 10)).toEqual([]);
        });
    });

    describe('RecipeImportItemsDal — choosing what to work on (no head-of-line blocking)', () => {
        const job = async () =>
            (
                await pool.query<{ id: string }>(
                    `INSERT INTO recipe_parse_jobs (owner_id, expires_at, status) VALUES ($1, now() + interval '1 day', 'running') RETURNING id`,
                    [USER],
                )
            ).rows[0]?.id ?? '';

        afterEach(async () => {
            await pool.query('DELETE FROM recipe_parse_jobs WHERE owner_id = $1', [USER]);
        });

        it('findNeedingJob returns the items that can be given a job NOW: paid with none; never an unpaid one, a refused one or one that has a job (rewritten: a recipe with no lines used to be listed here and matched at once, and is now refused)', async () => {
            const header = await newImport(5);

            await items.upsertItems(header.id, [
                { ordinal: 0, recipe: recipe('unpaid') },
                { ordinal: 1, recipe: recipe('paid, no job') },
                { ordinal: 2, recipe: recipe('has a job') },
                { ordinal: 3, recipe: recipe('no lines, refused', []) },
                { ordinal: 4, recipe: recipe('detached, paid') },
            ]);
            await pool.query(
                `UPDATE recipe_import_items SET allowance_spent_at = now() WHERE import_id = $1 AND ordinal IN (1, 2, 3, 4)`,
                [header.id],
            );
            await items.attachJob(header.id, 2, 0, await job());
            await pool.query(`UPDATE recipe_import_items SET stage = 'parsing' WHERE import_id = $1 AND ordinal = 4`, [
                header.id,
            ]);

            const found = await items.findNeedingJob(header.id, 10);

            // Item 3 is PAID and refused: the refusal alone keeps it out.
            expect(found.map((item) => item.ordinal)).toEqual([1, 4]);
            expect(found.every((item) => item.payload !== null)).toBe(true);
            expect((await items.findNeedingJob(header.id, 1)).map((item) => item.ordinal)).toEqual([1]);
        });

        it('findParsing returns only the items that hold a job, without their payloads, in the order they were last looked at (rewritten: it was ordinal order before the stuck-job fence)', async () => {
            const header = await newImport(3);

            await put(header.id, [0, 1, 2]);
            await pool.query(`UPDATE recipe_import_items SET allowance_spent_at = now() WHERE import_id = $1`, [
                header.id,
            ]);
            await items.attachJob(header.id, 2, 0, await job());
            await items.attachJob(header.id, 0, 0, await job());

            const found = await items.findParsing(header.id, 10);

            // Item 2 got its job first, so it was last looked at first. The ordinal only breaks a tie.
            expect(found.map((item) => item.ordinal)).toEqual([2, 0]);
            expect(found.every((item) => item.payload === null && item.parseJobId !== null)).toBe(true);
        });

        it('⛔ findParsing and findNeedingJob serve the least recently looked-at item first, and deferring one moves it to the back', async () => {
            const header = await newImport(4);

            await put(header.id, [0, 1, 2, 3]);
            await pool.query(`UPDATE recipe_import_items SET allowance_spent_at = now() WHERE import_id = $1`, [
                header.id,
            ]);
            // Items 0 and 1 hold a job that never lands; 2 and 3 are waiting for a job.
            await items.attachJob(header.id, 0, 0, await job());
            await items.attachJob(header.id, 1, 0, await job());

            expect((await items.findParsing(header.id, 10)).map((item) => item.ordinal)).toEqual([0, 1]);
            expect((await items.findNeedingJob(header.id, 10)).map((item) => item.ordinal)).toEqual([2, 3]);

            await items.deferItem(header.id, 0);
            await items.deferItem(header.id, 2);

            expect((await items.findParsing(header.id, 10)).map((item) => item.ordinal)).toEqual([1, 0]);
            expect((await items.findNeedingJob(header.id, 10)).map((item) => item.ordinal)).toEqual([3, 2]);
            // A window of one now reaches the item behind the stuck one.
            expect((await items.findParsing(header.id, 1)).map((item) => item.ordinal)).toEqual([1]);
        });

        it('⛔ findSaveCandidates returns matched items that HAVE a statement, least recently looked at first, and deferring one moves it to the back', async () => {
            const header = await newImport(4);

            await put(header.id, [0, 1, 2, 3]);
            await pool.query(
                `UPDATE recipe_import_items SET stage = 'matched', matched_at = now(), allowance_spent_at = now() WHERE import_id = $1`,
                [header.id],
            );
            await pool.query(
                `UPDATE recipe_import_items SET statement_kind = 'authored' WHERE import_id = $1 AND ordinal IN (0, 1, 3)`,
                [header.id],
            );

            expect((await items.findSaveCandidates(header.id, 10)).map((item) => item.ordinal)).toEqual([0, 1, 3]);

            await items.deferItem(header.id, 0);

            expect((await items.findSaveCandidates(header.id, 10)).map((item) => item.ordinal)).toEqual([1, 3, 0]);
            expect((await items.findSaveCandidates(header.id, 2)).map((item) => item.ordinal)).toEqual([1, 3]);
        });

        describe('⛔ a held item is not looked at again until the cook decides something (ADR-0072 §3 as amended 2026-11-11)', () => {
            async function matchedWithStatement(importId: string, ordinals: readonly number[]) {
                await put(importId, ordinals, { statement: { kind: 'authored' } });
                await pool.query(
                    `UPDATE recipe_import_items SET stage = 'matched', matched_at = now(), allowance_spent_at = now() WHERE import_id = $1`,
                    [importId],
                );
            }

            const candidates = async (importId: string) =>
                (await items.findSaveCandidates(importId, 10)).map((item) => item.ordinal).sort();

            it('never held, held at this revision, held at an older one: only the second is left out', async () => {
                const header = await newImport(3);

                await matchedWithStatement(header.id, [0, 1, 2]);

                const held = await items.findItem(header.id, 1);
                const older = await items.findItem(header.id, 2);

                expect(await items.holdItem(header.id, 1, held?.decisionRev ?? Number.NaN)).toBe(true);
                expect(await items.holdItem(header.id, 2, older?.decisionRev ?? Number.NaN)).toBe(true);
                // A decision after the hold: the item is looked at again, because what it is saved from changed.
                expect(await items.recordChoices(header.id, 2, { cuisine: 'Thai' })).toBe('ok');

                expect(await candidates(header.id)).toEqual([0, 2]);
            });

            it('⛔ a hold is fenced on the revision the save read: a decision that landed in between is never hidden', async () => {
                const header = await newImport(1);

                await matchedWithStatement(header.id, [0]);

                const read = await items.findItem(header.id, 0);

                await items.recordChoices(header.id, 0, { cuisine: 'Thai' });

                expect(await items.holdItem(header.id, 0, read?.decisionRev ?? Number.NaN)).toBe(false);
                expect((await items.findItem(header.id, 0))?.heldAtRev).toBeNull();
                expect(await candidates(header.id)).toEqual([0]);
            });

            it("a cuisine choice is a decision: it is stored and it moves the item's revision", async () => {
                const header = await newImport(1);

                await put(header.id, [0]);

                const before = await items.findItem(header.id, 0);

                await items.recordChoicesBatch(header.id, [{ ordinal: 0, cuisine: 'Mexican' }]);

                expect(await items.findItem(header.id, 0)).toMatchObject({
                    cuisine: 'Mexican',
                    decisionRev: (before?.decisionRev ?? Number.NaN) + 1,
                });
            });

            it('servings and times are decisions too: stored, a 0 kept as a value, and each moves the revision', async () => {
                const header = await newImport(1);

                await put(header.id, [0]);

                const before = await items.findItem(header.id, 0);

                expect(await items.recordChoices(header.id, 0, { servings: 6 })).toBe('ok');
                expect(
                    await items.recordChoicesBatch(header.id, [
                        { ordinal: 0, prepTimeMinutes: 0, cookTimeMinutes: 45 },
                    ]),
                ).toEqual({
                    kind: 'ok',
                });

                expect(await items.findItem(header.id, 0)).toMatchObject({
                    servings: 6,
                    prepTimeMinutes: 0,
                    cookTimeMinutes: 45,
                    decisionRev: (before?.decisionRev ?? Number.NaN) + 2,
                });
            });

            it('a choice that names only some of them leaves the others as they were', async () => {
                const header = await newImport(1);

                await put(header.id, [0]);
                await items.recordChoices(header.id, 0, { servings: 6, prepTimeMinutes: 5 });
                await items.recordChoices(header.id, 0, { cookTimeMinutes: 10 });

                expect(await items.findItem(header.id, 0)).toMatchObject({
                    servings: 6,
                    prepTimeMinutes: 5,
                    cookTimeMinutes: 10,
                });
            });
        });
    });

    describe('RecipeImportItemsDal.recordChoices', () => {
        it('records a statement and a visibility, and `null` clears the recipe’s own visibility', async () => {
            const header = await newImport();

            await put(header.id, [0]);
            expect(
                await items.recordChoices(header.id, 0, {
                    statement: { kind: 'paid_site', citation: 'site' },
                    visibility: 'public',
                }),
            ).toBe('ok');
            expect(await items.findItem(header.id, 0)).toMatchObject({
                statementKind: 'source',
                sourceKind: 'paid_site',
                visibility: 'public',
            });

            expect(await items.recordChoices(header.id, 0, { visibility: null })).toBe('ok');
            expect((await items.findItem(header.id, 0))?.visibility).toBeNull();
        });

        it('refuses a saved item and a missing one', async () => {
            const header = await newImport();

            await put(header.id, [0]);
            await pool.query(
                `UPDATE recipe_import_items SET stage = 'saved', saved_at = now(), matched_at = now(), allowance_spent_at = now(), payload = NULL, statement_kind = 'authored' WHERE import_id = $1 AND ordinal = 0`,
                [header.id],
            );

            expect(await items.recordChoices(header.id, 0, { visibility: 'public' })).toBe('saved');
            expect(await items.recordChoices(header.id, 3, { visibility: 'public' })).toBe('missing');
        });

        it('a batch is all or nothing', async () => {
            const header = await newImport();

            await put(header.id, [0, 1]);

            const result = await items.recordChoicesBatch(header.id, [
                { ordinal: 0, visibility: 'public' },
                { ordinal: 4, visibility: 'public' },
            ]);

            expect(result).toEqual({ kind: 'missing', ordinal: 4 });
            expect((await items.findItem(header.id, 0))?.visibility).toBeNull();
        });
    });

    describe('RecipeImportItemsDal.payUnpaid (the allowance, under the lock)', () => {
        async function ledger(userId = USER): Promise<number> {
            const result = await pool.query(
                `SELECT COALESCE(sum(units), 0)::int AS units FROM import_allowance_events WHERE user_id = $1 AND channel = 'bulk'`,
                [userId],
            );

            return (result.rows[0] as { units: number }).units;
        }

        it('pays the first N unpaid items in ordinal order, once, for exactly those items', async () => {
            const header = await newImport(6);

            await put(header.id, [0, 1, 2, 3, 4, 5]);

            const outcome = await items.payUnpaid(USER, header.id, { limit: 4, isPremium: true });

            expect(outcome).toEqual({ kind: 'paid', ordinals: [0, 1, 2, 3] });
            expect(await ledger()).toBe(4);

            const again = await items.payUnpaid(USER, header.id, { limit: 4, isPremium: true });

            expect(again).toEqual({ kind: 'paid', ordinals: [4, 5] });
            expect(await ledger()).toBe(6);
            expect(await items.payUnpaid(USER, header.id, { limit: 4, isPremium: true })).toEqual({ kind: 'nothing' });
        });

        it('⛔ pays only what fits the day: 997 spent leaves room for 3, and the rest waits', async () => {
            const header = await newImport(5);

            await put(header.id, [0, 1, 2, 3, 4]);
            await pool.query(
                `INSERT INTO import_allowance_events (user_id, channel, units, created_at) VALUES ($1, 'bulk', 997, clock_timestamp() - interval '1 hour')`,
                [USER],
            );

            const outcome = await items.payUnpaid(USER, header.id, { limit: 5, isPremium: true });

            expect(outcome).toMatchObject({ kind: 'paid', ordinals: [0, 1, 2] });
            expect(await ledger()).toBe(1000);
            expect((await items.findItem(header.id, 3))?.allowanceSpentAt).toBeNull();
        });

        it('⛔ a free cook pays under Free’s 200: 197 spent leaves room for 3, where a paid cook would have 803', async () => {
            const header = await newImport(5);

            await put(header.id, [0, 1, 2, 3, 4]);
            await pool.query(
                `INSERT INTO import_allowance_events (user_id, channel, units, created_at) VALUES ($1, 'bulk', 197, clock_timestamp() - interval '1 hour')`,
                [USER],
            );

            const outcome = await items.payUnpaid(USER, header.id, { limit: 5, isPremium: false });

            expect(outcome).toMatchObject({ kind: 'paid', ordinals: [0, 1, 2] });
            expect(await ledger()).toBe(200);
            expect((await items.findItem(header.id, 3))?.allowanceSpentAt).toBeNull();
        });

        it('⛔ a spent allowance pays nothing, writes no row, and says when more opens', async () => {
            const header = await newImport(2);

            await put(header.id, [0, 1]);
            await pool.query(
                `INSERT INTO import_allowance_events (user_id, channel, units, created_at) VALUES ($1, 'bulk', 1000, clock_timestamp() - interval '2 hours')`,
                [USER],
            );

            const outcome = await items.payUnpaid(USER, header.id, { limit: 2, isPremium: true });

            expect(outcome.kind).toBe('refused');
            expect(await ledger()).toBe(1000);
            expect((await items.findItem(header.id, 0))?.allowanceSpentAt).toBeNull();
        });

        it('never charges a recipe with no ingredient lines (nothing is sent for parsing, so no LLM spend starts)', async () => {
            const header = await newImport(2);

            await items.upsertItems(header.id, [
                { ordinal: 0, recipe: recipe('No lines', []) },
                { ordinal: 1, recipe: recipe('Has lines') },
            ]);

            expect(await items.payUnpaid(USER, header.id, { limit: 5, isPremium: true })).toEqual({
                kind: 'paid',
                ordinals: [1],
            });
            expect(await ledger()).toBe(1);
        });

        it('⛔ two concurrent calls never pay one item twice and never spend more than the items (kills: no row lock)', async () => {
            const header = await newImport(15);

            await put(
                header.id,
                Array.from({ length: 15 }, (_unused, index) => index),
            );

            const outcomes = await Promise.all([
                items.payUnpaid(USER, header.id, { limit: 10, isPremium: true }),
                items.payUnpaid(USER, header.id, { limit: 10, isPremium: true }),
            ]);
            const paid = outcomes.flatMap((outcome) => (outcome.kind === 'paid' ? outcome.ordinals : []));

            expect([...paid].sort((a, b) => a - b)).toEqual(Array.from({ length: 15 }, (_unused, index) => index));
            expect(new Set(paid).size).toBe(15);
            expect(await ledger()).toBe(15);
        });

        it('only the owner’s import is paid for', async () => {
            const theirs = await newImport(2, OTHER);

            await put(theirs.id, [0, 1]);

            expect(await items.payUnpaid(USER, theirs.id, { limit: 5, isPremium: true })).toEqual({ kind: 'nothing' });
            expect(await ledger()).toBe(0);
        });
    });

    describe('the parse job, the snapshot and the save claim', () => {
        async function paidItem(importId: string, ordinal: number) {
            await put(importId, [ordinal]);
            await pool.query(
                `UPDATE recipe_import_items SET allowance_spent_at = now() WHERE import_id = $1 AND ordinal = $2`,
                [importId, ordinal],
            );
        }

        async function realJob(): Promise<string> {
            const job = await pool.query<{ id: string }>(
                `INSERT INTO recipe_parse_jobs (owner_id, expires_at, status) VALUES ($1, now() + interval '1 day', 'running') RETURNING id`,
                [USER],
            );

            return job.rows[0]?.id ?? '';
        }

        afterEach(async () => {
            await pool.query('DELETE FROM recipe_parse_jobs WHERE owner_id = $1', [USER]);
        });

        /** The revision the save would have read. */
        async function revNow(importId: string): Promise<number> {
            return (await items.findItem(importId, 0))?.decisionRev ?? Number.NaN;
        }

        it('attaches a job once per generation (compare-and-swap) and moves the item to parsing', async () => {
            const header = await newImport();

            await paidItem(header.id, 0);

            const job = await realJob();

            expect(await items.attachJob(header.id, 0, 0, job)).toBe(true);
            expect(await items.attachJob(header.id, 0, 0, await realJob())).toBe(false);
            expect(await items.findItem(header.id, 0)).toMatchObject({
                stage: 'parsing',
                parseJobId: job,
                parseGeneration: 0,
            });
        });

        it('attaching the SAME job again is idempotent', async () => {
            const header = await newImport();

            await paidItem(header.id, 0);

            const job = await realJob();

            await items.attachJob(header.id, 0, 0, job);
            expect(await items.attachJob(header.id, 0, 0, job)).toBe(true);
        });

        it('an expired job detaches by bumping the generation, once', async () => {
            const header = await newImport();

            await paidItem(header.id, 0);
            await items.attachJob(header.id, 0, 0, await realJob());

            expect(await items.detachExpiredJob(header.id, 0, 0)).toBe(true);
            expect(await items.detachExpiredJob(header.id, 0, 0)).toBe(false);
            expect(await items.findItem(header.id, 0)).toMatchObject({
                parseJobId: null,
                parseGeneration: 1,
                stage: 'parsing',
            });
        });

        it('snapshots an item’s lines and moves it to matched, once (a second snapshot writes nothing)', async () => {
            const header = await newImport();

            await paidItem(header.id, 0);
            await items.attachJob(header.id, 0, 0, await realJob());

            const snapshot = [
                // The row the editor saves (0074): the cook's words as the shown name, and a dimension as the note.
                { ...snapshotLine(0, 0, '2 cups flour', 'flour'), displayText: 'bread flour', note: '9 inch' },
                snapshotLine(1, 0, '1 tsp salt and pepper', 'salt'),
                snapshotLine(1, 1, '1 tsp salt and pepper', 'pepper'),
            ];

            expect(await items.snapshot(header.id, 0, snapshot)).toBe(true);
            expect(await items.snapshot(header.id, 0, snapshot)).toBe(false);
            expect(await items.findItem(header.id, 0)).toMatchObject({ stage: 'matched' });
            expect(
                (await lines.findForItem(header.id, 0)).map((line) => [
                    line.lineIndex,
                    line.foodIndex,
                    line.phrase,
                    line.name,
                    line.displayText,
                    line.note,
                ]),
            ).toEqual([
                [0, 0, 'flour', 'flour', 'bread flour', '9 inch'],
                [1, 0, 'salt', 'salt', null, null],
                [1, 1, 'pepper', 'pepper', null, null],
            ]);
        });

        it('⛔ the save claim takes the item inside the recipe’s transaction once; the second finds zero rows and throws', async () => {
            const header = await newImport();

            await paidItem(header.id, 0);
            await items.attachJob(header.id, 0, 0, await realJob());
            await items.snapshot(header.id, 0, []);
            await items.recordChoices(header.id, 0, { statement: { kind: 'authored' } });

            const rev = await revNow(header.id);

            await db.transaction((tx) => items.claimSave(tx, header.id, 0, RECIPE_ID, rev));

            expect(await items.findItem(header.id, 0)).toMatchObject({
                stage: 'saved',
                recipeId: RECIPE_ID,
                payload: null,
            });
            await expect(db.transaction((tx) => items.claimSave(tx, header.id, 0, RECIPE_ID, rev))).rejects.toThrow(
                /already/iu,
            );
        });

        it('a claim that throws rolls the recipe’s transaction back (the claim and the recipe vanish together)', async () => {
            const header = await newImport();

            await paidItem(header.id, 0);
            await items.attachJob(header.id, 0, 0, await realJob());
            await items.snapshot(header.id, 0, []);
            await items.recordChoices(header.id, 0, { statement: { kind: 'authored' } });

            const rev = await revNow(header.id);

            await expect(
                db.transaction(async (tx) => {
                    await items.claimSave(tx, header.id, 0, RECIPE_ID, rev);
                    throw new Error('the recipe write failed');
                }),
            ).rejects.toThrow('the recipe write failed');

            expect(await items.findItem(header.id, 0)).toMatchObject({ stage: 'matched', recipeId: null });
        });

        it('refuses to save an item with no statement (the label is set from it)', async () => {
            const header = await newImport();

            await paidItem(header.id, 0);
            await items.attachJob(header.id, 0, 0, await realJob());
            await items.snapshot(header.id, 0, []);

            await expect(db.transaction((tx) => items.claimSave(tx, header.id, 0, RECIPE_ID, 0))).rejects.toThrow();
        });
    });

    // ── the save fence and the lock order ─────────────────────────────────────────────────────────────────────────

    describe('the decision fence (a save never ignores or outruns a cook’s decision)', () => {
        async function realJob(): Promise<string> {
            const job = await pool.query<{ id: string }>(
                `INSERT INTO recipe_parse_jobs (owner_id, expires_at, status) VALUES ($1, now() + interval '1 day', 'running') RETURNING id`,
                [USER],
            );

            return job.rows[0]?.id ?? '';
        }

        afterEach(async () => {
            await pool.query('DELETE FROM recipe_parse_jobs WHERE owner_id = $1', [USER]);
        });

        /** An item that is matched, paid, has a statement and one snapshot line: everything a save reads. */
        async function matchedItem(importId: string, ordinal = 0) {
            await put(importId, [ordinal]);
            await pool.query(
                `UPDATE recipe_import_items SET allowance_spent_at = now() WHERE import_id = $1 AND ordinal = $2`,
                [importId, ordinal],
            );
            await items.attachJob(importId, ordinal, 0, await realJob());
            // The picks below are made against `jd-0`, so the line must be judged under it.
            await items.snapshot(importId, ordinal, [
                { ...snapshotLine(0, 0, '2 cups flour', 'flour'), judgementDigest: 'jd-0' },
            ]);
            await items.recordChoices(importId, ordinal, { statement: { kind: 'authored' } });

            const item = await items.findItem(importId, ordinal);

            if (item === undefined) {
                throw new Error('the matched item is missing');
            }

            return item;
        }

        async function revOf(importId: string, ordinal = 0): Promise<number> {
            return (await items.findItem(importId, ordinal))?.decisionRev ?? -1;
        }

        it('starts at 0 and moves with every write of a decision: choices, a review mark, a replaced statement', async () => {
            const header = await newImport();

            await put(header.id, [0]);
            expect(await revOf(header.id)).toBe(0);

            await items.recordChoices(header.id, 0, { visibility: 'public' });
            expect(await revOf(header.id)).toBe(1);

            await items.recordChoicesBatch(header.id, [{ ordinal: 0, visibility: null }]);
            expect(await revOf(header.id)).toBe(2);

            await imports.moveCursor(USER, header.id, { from: 0, to: 1, mark: { ordinal: 0, review: 'reviewed' } });
            expect(await revOf(header.id)).toBe(3);

            await put(header.id, [0], { statement: { kind: 'authored' } });
            expect(await revOf(header.id)).toBe(4);
        });

        it('does not move for a write that decides nothing: a cursor move with no mark, an identical replay', async () => {
            const header = await newImport();

            await put(header.id, [0]);
            await imports.moveCursor(USER, header.id, { from: 0, to: 1 });
            await put(header.id, [0]);

            expect(await revOf(header.id)).toBe(0);
        });

        it('moves when a received item’s recipe is replaced', async () => {
            const header = await newImport();

            await put(header.id, [0]);
            await items.upsertItems(header.id, [{ ordinal: 0, recipe: recipe('A new title') }]);

            expect(await revOf(header.id)).toBe(1);
        });

        it('⛔ a pick on an unsaved item moves the revision; on a saved item it is refused and writes nothing', async () => {
            const header = await newImport(2);
            const unsaved = await matchedItem(header.id, 0);

            expect(await lines.recordPick(USER, header.id, 0, 0, 0, 'jd-0', { kind: 'asWritten' }, BEFORE_SAVE)).toBe(
                'applied',
            );
            expect(await revOf(header.id, 0)).toBe(unsaved.decisionRev + 1);

            const second = await matchedItem(header.id, 1);

            await pool.query(`UPDATE recipe_import_lines SET judgement_digest = 'jd-0' WHERE import_id = $1`, [
                header.id,
            ]);
            await db.transaction((tx) => items.claimSave(tx, header.id, 1, RECIPE_ID, second.decisionRev));

            expect(await lines.recordPick(USER, header.id, 1, 0, 0, 'jd-0', { kind: 'asWritten' }, BEFORE_SAVE)).toBe(
                'saved',
            );
            expect((await lines.findForItem(header.id, 1))[0]).toMatchObject({ pickedAgainstDigest: null });
        });

        it('a pick recorded after the rebind of a saved draft does not move the revision (there is nothing left to fence)', async () => {
            const header = await newImport(1);
            const item = await matchedItem(header.id, 0);

            await db.transaction((tx) => items.claimSave(tx, header.id, 0, RECIPE_ID, item.decisionRev));

            expect(await lines.recordPick(USER, header.id, 0, 0, 0, 'jd-0', { kind: 'asWritten' }, AFTER_REBIND)).toBe(
                'applied',
            );
            expect(await revOf(header.id)).toBe(item.decisionRev);
        });

        it('⛔ the claim succeeds only for the revision the save read: a decision in between rolls the recipe back', async () => {
            const header = await newImport();
            const read = await matchedItem(header.id);

            // The cook changes their mind while the save is asking food to admit foods.
            await items.recordChoices(header.id, 0, { visibility: 'public' });

            await expect(
                db.transaction((tx) => items.claimSave(tx, header.id, 0, RECIPE_ID, read.decisionRev)),
            ).rejects.toMatchObject({ name: 'ImportItemChangedError' });
            expect(await items.findItem(header.id, 0)).toMatchObject({ stage: 'matched', recipeId: null });

            // The next call reads the new state and saves from it.
            const reread = await items.findItem(header.id, 0);

            await db.transaction((tx) =>
                items.claimSave(tx, header.id, 0, RECIPE_ID, reread?.decisionRev ?? Number.NaN),
            );
            expect(await items.findItem(header.id, 0)).toMatchObject({ stage: 'saved', visibility: 'public' });
        });

        it('an item saved by someone else is “already claimed”, not “changed”: the caller counts it as done', async () => {
            const header = await newImport();
            const read = await matchedItem(header.id);

            await db.transaction((tx) => items.claimSave(tx, header.id, 0, RECIPE_ID, read.decisionRev));

            await expect(
                db.transaction((tx) => items.claimSave(tx, header.id, 0, RECIPE_ID, read.decisionRev)),
            ).rejects.toMatchObject({ name: 'ImportItemAlreadyClaimedError' });
        });

        it('⛔ a save racing a choices call ends one of two ways, never both “saved” and “the choice was accepted”', async () => {
            for (let round = 0; round < 12; round += 1) {
                const header = await newImport();
                const read = await matchedItem(header.id);
                const [claim, choice] = await Promise.allSettled([
                    db.transaction((tx) => items.claimSave(tx, header.id, 0, RECIPE_ID, read.decisionRev)),
                    items.recordChoices(header.id, 0, { visibility: 'public' }),
                ]);
                const saved = claim.status === 'fulfilled';

                if (saved) {
                    expect(choice).toMatchObject({ status: 'fulfilled', value: 'saved' });
                } else {
                    expect(claim).toMatchObject({ reason: { name: 'ImportItemChangedError' } });
                    expect(choice).toMatchObject({ status: 'fulfilled', value: 'ok' });
                }

                // One recipe backs at most one item, so each round starts from a clean import.
                await pool.query('DELETE FROM recipe_imports WHERE id = $1', [header.id]);
            }
        });
    });

    describe('one lock order (header, then item, then line): no two writers of one import deadlock', () => {
        it('⛔ a save claim, a cursor move with a mark, a choices call and a payment racing on one import all finish', async () => {
            const failures: unknown[] = [];

            for (let round = 0; round < 25; round += 1) {
                const header = await newImport(2);

                await put(header.id, [0, 1]);
                await pool.query(
                    `UPDATE recipe_import_items SET stage = 'matched', allowance_spent_at = now(), matched_at = now(),
                            statement_kind = 'authored' WHERE import_id = $1 AND ordinal = 0`,
                    [header.id],
                );

                const results = await Promise.allSettled([
                    db.transaction((tx) => items.claimSave(tx, header.id, 0, RECIPE_ID, 0)),
                    imports.moveCursor(USER, header.id, { from: 0, to: 1, mark: { ordinal: 0, review: 'reviewed' } }),
                    items.recordChoicesBatch(header.id, [{ ordinal: 0, visibility: 'public' }]),
                    items.payUnpaid(USER, header.id, { limit: 10, isPremium: true }),
                ]);

                failures.push(
                    ...results.flatMap((result) =>
                        result.status === 'rejected' &&
                        (result.reason as { code?: string; cause?: { code?: string } }).code !== undefined
                            ? [result.reason]
                            : result.status === 'rejected' &&
                                String((result.reason as { cause?: { code?: string } }).cause?.code ?? '') === '40P01'
                              ? [result.reason]
                              : [],
                    ),
                );
            }

            expect(
                failures,
                'a deadlock (40P01) means two writers took the header and the item in opposite orders',
            ).toEqual([]);
        });
    });

    // ── the lines ─────────────────────────────────────────────────────────────────────────────────────────────────

    describe('RecipeImportLinesDal', () => {
        async function savedItemWithLines(
            userId: string,
            lineSpecs: readonly {
                lineIndex: number;
                boundBy: string | null;
                candidates?: number;
                food?: boolean;
            }[],
        ) {
            const header = await newImport(1, userId);

            await put(header.id, [0]);
            await pool.query(
                `UPDATE recipe_import_items SET stage = 'saved', saved_at = now(), matched_at = now(), allowance_spent_at = now(), payload = NULL,
                        statement_kind = 'authored', recipe_id = $3 WHERE import_id = $1 AND ordinal = $2`,
                [header.id, 0, RECIPE_ID],
            );

            const ids: string[] = [];

            for (const spec of lineSpecs) {
                const candidates = JSON.stringify(
                    Array.from({ length: spec.candidates ?? 0 }, (_unused, index) => ({
                        kind: 'root',
                        id: `f${String(index)}`,
                        rung: null,
                        isDefault: false,
                    })),
                );
                const line = await pool.query<{ id: string }>(
                    `INSERT INTO recipe_import_lines (import_id, ordinal, line_index, food_index, source_line, line_digest, judgement_digest, phrase, name, unit, candidates,
                                                      matched_by, food_id, review)
                     VALUES ($1, 0, $2, 0, $3, 'ld', $4, 'p', 'p', '', $5::jsonb, $6, $7, $8) RETURNING id`,
                    [
                        header.id,
                        spec.lineIndex,
                        `line ${String(spec.lineIndex)}`,
                        `jd-${String(spec.lineIndex)}`,
                        candidates,
                        spec.food === true ? 'lexical' : null,
                        spec.food === true ? 'f0' : null,
                        spec.food === true ? 'refused' : null,
                    ],
                );
                const id = line.rows[0]?.id ?? '';

                ids.push(id);
                await pool.query(
                    `INSERT INTO ingredients (recipe_id, food_lookup_id, quantity, unit, sort_order, bound_by, import_line_id)
                     VALUES ($1, $2, 1, '', $3, $4, $5)`,
                    [RECIPE_ID, LOOKUP, spec.lineIndex, spec.boundBy, id],
                );
            }

            return { header, ids };
        }

        it('records a pick only against the digest the cook saw, and says so when it is stale', async () => {
            const { header } = await savedItemWithLines(USER, [{ lineIndex: 0, boundBy: null, candidates: 2 }]);

            expect(
                await lines.recordPick(
                    USER,
                    header.id,
                    0,
                    0,
                    0,
                    'old-digest',
                    { kind: 'food', id: 'f1' },
                    AFTER_REBIND,
                ),
            ).toBe('stale');
            expect(
                await lines.recordPick(USER, header.id, 0, 0, 0, 'jd-0', { kind: 'variant', id: 'v9' }, AFTER_REBIND),
            ).toBe('applied');
            expect((await lines.findForItem(header.id, 0))[0]).toMatchObject({
                pickedFoodVariantId: 'v9',
                pickedFoodId: null,
                pickedAsWritten: false,
                pickedAgainstDigest: 'jd-0',
            });

            expect(await lines.recordPick(USER, header.id, 0, 0, 0, 'jd-0', { kind: 'asWritten' }, AFTER_REBIND)).toBe(
                'applied',
            );
            expect((await lines.findForItem(header.id, 0))[0]).toMatchObject({
                pickedFoodVariantId: null,
                pickedAsWritten: true,
            });
        });

        it('⛔ a stranger’s pick finds no line', async () => {
            const { header } = await savedItemWithLines(USER, [{ lineIndex: 0, boundBy: null, candidates: 1 }]);

            expect(
                await lines.recordPick(OTHER, header.id, 0, 0, 0, 'jd-0', { kind: 'food', id: 'f1' }, AFTER_REBIND),
            ).toBe('missing');
        });

        describe('the “to check” list and count', () => {
            it('is exactly the as-written lines nobody picked, with something to pick, on a live recipe the caller owns', async () => {
                const { header, ids } = await savedItemWithLines(USER, [
                    { lineIndex: 0, boundBy: null, candidates: 2 }, // waiting
                    { lineIndex: 1, boundBy: 'exact', candidates: 2, food: true }, // bound, not as written
                    { lineIndex: 2, boundBy: null, candidates: 0 }, // nothing to pick from
                    { lineIndex: 3, boundBy: null, candidates: 1 }, // picked below
                    { lineIndex: 4, boundBy: 'cook', candidates: 1 }, // the cook's own
                    { lineIndex: 5, boundBy: null, candidates: 0, food: true }, // a proposal alone is something to pick
                ]);

                await lines.recordPick(USER, header.id, 0, 3, 0, 'jd-3', { kind: 'asWritten' }, AFTER_REBIND);

                const list = await lines.listToCheck(USER, header.id, undefined, 10);

                expect(list.map((row) => row.line.lineIndex)).toEqual([0, 5]);
                expect(list.map((row) => row.line.id)).toEqual([ids[0], ids[5]]);
                expect(await lines.countToCheck(USER)).toBe(2);
                expect(await lines.countToCheck(OTHER)).toBe(0);
                expect(await lines.listToCheck(OTHER, header.id, undefined, 10)).toEqual([]);
            });

            it('drops a line whose recipe was deleted, and one the cook edited into a food (the link is gone)', async () => {
                const { ids } = await savedItemWithLines(USER, [
                    { lineIndex: 0, boundBy: null, candidates: 1 },
                    { lineIndex: 1, boundBy: null, candidates: 1 },
                ]);

                await pool.query(
                    `UPDATE ingredients SET import_line_id = NULL, bound_by = 'cook' WHERE import_line_id = $1`,
                    [ids[1]],
                );
                expect(await lines.countToCheck(USER)).toBe(1);

                await pool.query('UPDATE recipes SET deleted_at = now() WHERE id = $1', [RECIPE_ID]);
                expect(await lines.countToCheck(USER)).toBe(0);
            });

            it('pages by an opaque position without skipping or repeating a line', async () => {
                const { header } = await savedItemWithLines(
                    USER,
                    Array.from({ length: 5 }, (_unused, lineIndex) => ({ lineIndex, boundBy: null, candidates: 1 })),
                );

                const first = await lines.listToCheck(USER, header.id, undefined, 2);
                const lastOfFirst = first.at(-1)?.line;
                const second = await lines.listToCheck(
                    USER,
                    header.id,
                    lastOfFirst === undefined
                        ? undefined
                        : {
                              ordinal: lastOfFirst.ordinal,
                              lineIndex: lastOfFirst.lineIndex,
                              foodIndex: lastOfFirst.foodIndex,
                          },
                    2,
                );

                expect(first.map((row) => row.line.lineIndex)).toEqual([0, 1]);
                expect(second.map((row) => row.line.lineIndex)).toEqual([2, 3]);
            });
        });

        describe('the flaggable lines', () => {
            it('are the lines the import bound without the cook: every origin but `cook`, on a live recipe the caller owns', async () => {
                const { header } = await savedItemWithLines(USER, [
                    { lineIndex: 0, boundBy: 'exact', candidates: 1, food: true },
                    { lineIndex: 1, boundBy: 'autoBest', candidates: 1, food: true },
                    { lineIndex: 2, boundBy: 'cook', candidates: 1, food: true },
                    { lineIndex: 3, boundBy: null, candidates: 1 },
                    { lineIndex: 4, boundBy: 'default', candidates: 1, food: true },
                ]);

                const list = await lines.listFlaggable(USER, header.id, undefined, 10);

                expect(list.map((row) => [row.line.lineIndex, row.boundBy])).toEqual([
                    [0, 'exact'],
                    [1, 'autoBest'],
                    [4, 'default'],
                ]);
                expect(list.every((row) => row.recipeId === RECIPE_ID && row.foodLookupId === LOOKUP)).toBe(true);
                expect(await lines.listFlaggable(OTHER, header.id, undefined, 10)).toEqual([]);
            });

            it('finds the draft line a pick must rebind, by the snapshot line, for the owner only', async () => {
                const { header } = await savedItemWithLines(USER, [
                    { lineIndex: 0, boundBy: 'exact', candidates: 1, food: true },
                ]);

                await pool.query('UPDATE recipes SET current_version = 9 WHERE id = $1', [RECIPE_ID]);

                // The draft's version comes back in the SAME read as the line's position: a rebind that read the version in a
                // second query could pair a position from before an edit with a version from after it.
                expect(await lines.findLinkedIngredient(USER, header.id, 0, 0, 0)).toMatchObject({
                    recipeId: RECIPE_ID,
                    sortOrder: 0,
                    boundBy: 'exact',
                    recipeVersion: 9,
                });
                expect(await lines.findLinkedIngredient(OTHER, header.id, 0, 0, 0)).toBeUndefined();
            });

            it('reads one line, for its owner only', async () => {
                const { header, ids } = await savedItemWithLines(USER, [
                    { lineIndex: 0, boundBy: null, candidates: 1 },
                ]);

                expect((await lines.findLine(USER, header.id, 0, 0, 0))?.id).toBe(ids[0]);
                expect(await lines.findLine(OTHER, header.id, 0, 0, 0)).toBeUndefined();
                expect(await lines.findLine(USER, header.id, 0, 9, 0)).toBeUndefined();
            });

            it('reads what an item’s lines became: bound or kept as written, on a live recipe, for its owner only', async () => {
                const { header, ids } = await savedItemWithLines(USER, [
                    { lineIndex: 0, boundBy: 'exact', candidates: 1, food: true },
                    { lineIndex: 1, boundBy: null, candidates: 1 },
                ]);

                const linked = await lines.findLinkedForItem(USER, header.id, 0);

                expect([...linked.keys()].sort()).toEqual([...ids].sort());
                expect(linked.get(ids[0] ?? '')).toMatchObject({
                    boundBy: 'exact',
                    recipeId: RECIPE_ID,
                    foodLookupId: LOOKUP,
                });
                expect(linked.get(ids[1] ?? '')?.boundBy).toBeNull();
                expect((await lines.findLinkedForItem(OTHER, header.id, 0)).size).toBe(0);

                await pool.query('UPDATE recipes SET deleted_at = now() WHERE id = $1', [RECIPE_ID]);
                expect((await lines.findLinkedForItem(USER, header.id, 0)).size).toBe(0);
            });

            it('stores the key the verdict about the saved line lives under', async () => {
                const { header, ids } = await savedItemWithLines(USER, [
                    { lineIndex: 0, boundBy: 'exact', candidates: 1, food: true },
                ]);

                await db.transaction((tx) => lines.setSavedKeys(tx, [{ id: ids[0] ?? '', key: 'v1:abc' }]));

                expect((await lines.findForItem(header.id, 0))[0]?.savedVerificationKey).toBe('v1:abc');
            });
        });
    });
});

/** A snapshot line as the importer writes it. */
function snapshotLine(lineIndex: number, foodIndex: number, sourceLine: string, phrase: string) {
    return {
        lineIndex,
        foodIndex,
        sourceLine,
        lineDigest: `ld-${String(lineIndex)}`,
        judgementDigest: `jd-${String(lineIndex)}-${String(foodIndex)}`,
        phrase,
        quantity: '2',
        quantityHigh: null,
        unit: 'cup',
        statedQuantity: null,
        statedQuantityHigh: null,
        statedUnit: null,
        preparation: null,
        name: phrase,
        displayText: null,
        note: null,
        matchedBy: null,
        foodId: null,
        foodVariantId: null,
        rung: null,
        margin: null,
        candidates: [],
        verificationKey: null,
        review: null,
    };
}
