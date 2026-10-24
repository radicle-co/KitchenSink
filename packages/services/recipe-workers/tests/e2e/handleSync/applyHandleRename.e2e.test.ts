/**
 * The handle-sync CONSUMER ({@link applyHandleRename}) against a real Postgres (LOCAL e2e, §7.1a).
 *
 * Moved here from recipe-service's `authorHandles.e2e.test.ts`, which drove `AuthorHandlesDal.applyRename` — a
 * second copy of this rule that nothing in production called. This file drives the copy that runs: the worker's.
 *
 * Pins the properties the sync depends on, which only a real database answers:
 *
 *   - **Fan-out:** an applied event updates the read model AND every owned `recipes.author_handle` +
 *     `recipe_versions.editor_handle`, in one transaction, and never another owner's rows.
 *   - **Monotonic + out-of-order safety:** an older-or-equal `source_timestamp` is ignored; A→B→A redelivered out
 *     of order converges to the actual latest, so redelivery and cross-route races cannot corrupt it.
 *
 * Connects as `recipe_app` (ADR-0039), the role the worker holds.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import { pseudonymizedAuthorHandle } from '@kitchensink/recipe-core';

import { eraseRecipeRows } from '../../../src/handlers/accountErasureWorker.js';
import { applyHandleRename, applyHandleRenameWithin } from '../../../src/handlers/handleSyncWorker.js';
import { recipeWorkersDb } from '../roleDb.js';

const roleDb = recipeWorkersDb();

const USER = '01JHANDLEE2E0000USER00000A';
const OTHER = '01JHANDLEE2E000OTHER00000B';

describe('applyHandleRename (real Postgres)', () => {
    let pool: pg.Pool;
    let db: NodePgDatabase<Record<string, never>>;
    let recipeId: string;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: roleDb.appUrl, max: 3 });
        db = drizzle(pool);
    });

    afterAll(async () => {
        await pool.query('DELETE FROM recipes WHERE owner_id = ANY($1)', [[USER, OTHER]]);
        await pool.query('DELETE FROM author_handles WHERE user_id = ANY($1)', [[USER, OTHER]]);
        await pool.end();
    });

    beforeEach(async () => {
        await pool.query('DELETE FROM recipes WHERE owner_id = ANY($1)', [[USER, OTHER]]);
        await pool.query('DELETE FROM author_handles WHERE user_id = ANY($1)', [[USER, OTHER]]);

        // A recipe owned by USER, with an author_handle to be corrected, and one version they authored.
        const { rows } = await pool.query<{ id: string }>(
            `INSERT INTO recipes (owner_id, title, visibility, status, servings, prep_time_minutes, cook_time_minutes, total_time_minutes, author_handle)
             VALUES ($1, 'Handle E2E', 'public', 'published', 2, 5, 10, 15, 'Old Name') RETURNING id`,
            [USER],
        );
        recipeId = rows[0]!.id;
        await pool.query(
            `INSERT INTO recipe_versions (recipe_id, version_number, snapshot, created_by, editor_handle)
             VALUES ($1, 1, '{}'::jsonb, $2, 'Old Name')`,
            [recipeId, USER],
        );
        // A recipe owned by SOMEONE ELSE — must never be touched by USER's rename.
        await pool.query(
            `INSERT INTO recipes (owner_id, title, visibility, status, servings, prep_time_minutes, cook_time_minutes, total_time_minutes, author_handle)
             VALUES ($1, 'Other', 'public', 'published', 2, 5, 10, 15, 'Other Name')`,
            [OTHER],
        );
    });

    async function readModelOf(userId: string): Promise<string | undefined> {
        const { rows } = await pool.query<{ display_name: string }>(
            'SELECT display_name FROM author_handles WHERE user_id = $1',
            [userId],
        );

        return rows[0]?.display_name;
    }

    async function handleOf(id: string): Promise<string | null> {
        const { rows } = await pool.query<{ author_handle: string | null }>(
            'SELECT author_handle FROM recipes WHERE id = $1',
            [id],
        );

        return rows[0]!.author_handle;
    }

    async function editorOf(id: string): Promise<string | null> {
        const { rows } = await pool.query<{ editor_handle: string | null }>(
            'SELECT editor_handle FROM recipe_versions WHERE recipe_id = $1',
            [id],
        );

        return rows[0]!.editor_handle;
    }

    async function usernamesOf(id: string): Promise<{ author: string | null; editor: string | null }> {
        const recipe = await pool.query<{ author_username: string | null }>(
            'SELECT author_username FROM recipes WHERE id = $1',
            [id],
        );
        const version = await pool.query<{ editor_username: string | null }>(
            'SELECT editor_username FROM recipe_versions WHERE recipe_id = $1',
            [id],
        );

        return { author: recipe.rows[0]!.author_username, editor: version.rows[0]!.editor_username };
    }

    async function readModelUsernameOf(userId: string): Promise<string | null | undefined> {
        const { rows } = await pool.query<{ username: string | null }>(
            'SELECT username FROM author_handles WHERE user_id = $1',
            [userId],
        );

        return rows[0]?.username;
    }

    it('applies an event and fans it out to the owner’s recipes + versions (not other users’)', async () => {
        const applied = await applyHandleRename(db, {
            userId: USER,
            displayName: 'New Name',
            username: 'newname',
            sourceTimestamp: '2026-07-20T00:00:00.000Z',
        });

        expect(applied).toBe(true);
        expect(await readModelOf(USER)).toBe('New Name');
        expect(await handleOf(recipeId)).toBe('New Name');
        expect(await editorOf(recipeId)).toBe('New Name');
        const { rows } = await pool.query<{ author_handle: string }>(
            'SELECT author_handle FROM recipes WHERE owner_id = $1',
            [OTHER],
        );
        expect(rows[0]!.author_handle).toBe('Other Name');
    });

    it('IGNORES an older-or-equal source_timestamp (monotonic guard)', async () => {
        await applyHandleRename(db, {
            userId: USER,
            displayName: 'V2',
            username: null,
            sourceTimestamp: '2026-07-20T12:00:00.000Z',
        });

        const stale = await applyHandleRename(db, {
            userId: USER,
            displayName: 'V1-late',
            username: null,
            sourceTimestamp: '2026-07-20T06:00:00.000Z',
        });
        const equal = await applyHandleRename(db, {
            userId: USER,
            displayName: 'V2-again',
            username: null,
            sourceTimestamp: '2026-07-20T12:00:00.000Z',
        });

        expect(stale).toBe(false);
        expect(equal).toBe(false);
        expect(await readModelOf(USER)).toBe('V2');
        expect(await handleOf(recipeId)).toBe('V2');
    });

    it('converges to the actual latest for A→B→A redelivered OUT OF ORDER', async () => {
        // Delivered out of order: the newest (back to "Ada") arrives first, then the older ones.
        await applyHandleRename(db, {
            userId: USER,
            displayName: 'Ada',
            username: null,
            sourceTimestamp: '2026-07-20T03:00:00.000Z',
        });
        await applyHandleRename(db, {
            userId: USER,
            displayName: 'Bob',
            username: null,
            sourceTimestamp: '2026-07-20T02:00:00.000Z',
        });
        await applyHandleRename(db, {
            userId: USER,
            displayName: 'Ada-old',
            username: null,
            sourceTimestamp: '2026-07-20T01:00:00.000Z',
        });

        expect(await readModelOf(USER)).toBe('Ada');
        expect(await handleOf(recipeId)).toBe('Ada');
    });

    // Plan 2026-10-15-010 D6/D7: the snapshot carries the username too, and the fan-out writes it beside the name.
    it('fans the USERNAME out to the read model, the owner’s recipes and their versions', async () => {
        await applyHandleRename(db, {
            userId: USER,
            displayName: 'New Name',
            username: 'newname',
            sourceTimestamp: '2026-07-20T00:00:00.000Z',
        });

        expect(await readModelUsernameOf(USER)).toBe('newname');
        expect(await usernamesOf(recipeId)).toEqual({ author: 'newname', editor: 'newname' });
    });

    it('applies a USERNAME-ONLY change — the display name is the same, the snapshot is newer', async () => {
        await applyHandleRename(db, {
            userId: USER,
            displayName: 'Ada',
            username: 'ada',
            sourceTimestamp: '2026-07-20T01:00:00.000Z',
        });

        const applied = await applyHandleRename(db, {
            userId: USER,
            displayName: 'Ada',
            username: 'ada_cooks',
            sourceTimestamp: '2026-07-20T02:00:00.000Z',
        });

        expect(applied).toBe(true);
        expect(await usernamesOf(recipeId)).toEqual({ author: 'ada_cooks', editor: 'ada_cooks' });
        expect(await handleOf(recipeId)).toBe('Ada');
    });

    it('never lets an OLDER snapshot take the username back', async () => {
        await applyHandleRename(db, {
            userId: USER,
            displayName: 'Ada',
            username: 'new',
            sourceTimestamp: '2026-07-20T03:00:00.000Z',
        });
        await applyHandleRename(db, {
            userId: USER,
            displayName: 'Ada',
            username: 'old',
            sourceTimestamp: '2026-07-20T01:00:00.000Z',
        });

        expect(await readModelUsernameOf(USER)).toBe('new');
        expect(await usernamesOf(recipeId)).toEqual({ author: 'new', editor: 'new' });
    });

    it('clears the copies when the snapshot says the cook has NO username', async () => {
        await applyHandleRename(db, {
            userId: USER,
            displayName: 'Ada',
            username: 'ada',
            sourceTimestamp: '2026-07-20T01:00:00.000Z',
        });
        await applyHandleRename(db, {
            userId: USER,
            displayName: 'Ada',
            username: null,
            sourceTimestamp: '2026-07-20T02:00:00.000Z',
        });

        expect(await readModelUsernameOf(USER)).toBeNull();
        expect(await usernamesOf(recipeId)).toEqual({ author: null, editor: null });
    });

    describe('⛔ erasure FENCES the read model — a late snapshot must not re-identify an erased author (0056)', () => {
        const LATE = {
            userId: USER,
            displayName: 'Real Name',
            username: 'realname',
            sourceTimestamp: '2030-01-01T00:00:00.000Z',
        };

        /** What the world can read about USER's byline after erasure: the kept recipe, its version, the read model. */
        async function bylineAfterErasure(): Promise<{
            recipe: { author_handle: string | null; author_username: string | null };
            editor: { editor_handle: string | null; editor_username: string | null };
            readModel: { display_name: string; username: string | null; erased: boolean } | undefined;
        }> {
            const recipe = await pool.query<{ author_handle: string | null; author_username: string | null }>(
                'SELECT author_handle, author_username FROM recipes WHERE id = $1',
                [recipeId],
            );
            const editor = await pool.query<{ editor_handle: string | null; editor_username: string | null }>(
                'SELECT editor_handle, editor_username FROM recipe_versions WHERE recipe_id = $1',
                [recipeId],
            );
            const readModel = await pool.query<{ display_name: string; username: string | null; erased: boolean }>(
                'SELECT display_name, username, erased_at IS NOT NULL AS erased FROM author_handles WHERE user_id = $1',
                [USER],
            );

            return { recipe: recipe.rows[0]!, editor: editor.rows[0]!, readModel: readModel.rows[0] };
        }

        const PSEUDONYM = pseudonymizedAuthorHandle(USER);

        it('(a) refuses a NEWER snapshot after erasure — kept rows keep the pseudonym and no username', async () => {
            await applyHandleRename(db, { ...LATE, sourceTimestamp: '2026-07-20T00:00:00.000Z' });
            await eraseRecipeRows(db, USER, []);

            // RED before the fence: the row was deleted, so this took the INSERT branch and returned true.
            expect(await applyHandleRename(db, LATE)).toBe(false);

            expect(await bylineAfterErasure()).toEqual({
                recipe: { author_handle: PSEUDONYM, author_username: null },
                editor: { editor_handle: PSEUDONYM, editor_username: null },
                readModel: { display_name: PSEUDONYM, username: null, erased: true },
            });
        });

        it('(b) refuses a snapshot for a user who had NEVER synced — erasure fences before any row existed', async () => {
            expect(await readModelOf(USER)).toBeUndefined();

            await eraseRecipeRows(db, USER, []);

            expect(await applyHandleRename(db, LATE)).toBe(false);
            expect((await bylineAfterErasure()).recipe).toEqual({ author_handle: PSEUDONYM, author_username: null });
        });

        it('(d) refuses an OLDER redelivered snapshot after erasure too', async () => {
            await applyHandleRename(db, { ...LATE, sourceTimestamp: '2026-07-20T00:00:00.000Z' });
            await eraseRecipeRows(db, USER, []);

            expect(await applyHandleRename(db, { ...LATE, sourceTimestamp: '2020-01-01T00:00:00.000Z' })).toBe(false);
            expect((await bylineAfterErasure()).readModel).toEqual({
                display_name: PSEUDONYM,
                username: null,
                erased: true,
            });
        });

        it('an erasure replay keeps the FIRST erased_at', async () => {
            await eraseRecipeRows(db, USER, []);
            const first = await pool.query<{ erased_at: Date }>(
                'SELECT erased_at FROM author_handles WHERE user_id = $1',
                [USER],
            );
            await eraseRecipeRows(db, USER, []);
            const second = await pool.query<{ erased_at: Date }>(
                'SELECT erased_at FROM author_handles WHERE user_id = $1',
                [USER],
            );

            expect(second.rows[0]!.erased_at).toEqual(first.rows[0]!.erased_at);
        });

        it('(c) an apply and an erasure running CONCURRENTLY end pseudonymized, in either interleaving', async () => {
            // A applies a snapshot inside a transaction it holds open; B erases meanwhile. Both take author_handles
            // first (same lock order), so B WAITS for A, then tombstones over A's row and scrubs A's fan-out.
            let release!: () => void;
            const gate = new Promise<void>((resolve) => {
                release = resolve;
            });
            let aApplied: boolean | undefined;
            let aHasApplied!: () => void;
            const applyRan = new Promise<void>((resolve) => {
                aHasApplied = resolve;
            });
            const a = db.transaction(async (tx) => {
                aApplied = await applyHandleRenameWithin(tx, LATE);
                aHasApplied();
                await gate;
            });

            // B starts only once A's statements have run (and hold their row locks), so B must queue behind A.
            await applyRan;
            const b = eraseRecipeRows(db, USER, []);
            const deadline = Date.now() + 10_000;
            let blocked = false;

            while (!blocked && Date.now() < deadline) {
                const { rows } = await pool.query<{ waiting: number }>(
                    `SELECT count(*)::int AS waiting FROM pg_stat_activity
                      WHERE datname = current_database() AND wait_event_type = 'Lock'`,
                );

                blocked = rows[0]!.waiting > 0;

                if (!blocked) {
                    await new Promise((resolve) => setTimeout(resolve, 25));
                }
            }

            expect(blocked, 'erasure never blocked behind the open apply — the lock orders do not meet').toBe(true);

            release();
            await Promise.all([a, b]);

            expect(aApplied).toBe(true);
            expect(await bylineAfterErasure()).toEqual({
                recipe: { author_handle: PSEUDONYM, author_username: null },
                editor: { editor_handle: PSEUDONYM, editor_username: null },
                readModel: { display_name: PSEUDONYM, username: null, erased: true },
            });
        });
    });
});
