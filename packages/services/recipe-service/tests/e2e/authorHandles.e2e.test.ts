/**
 * W8-a.2 — integration proof of the handle-sync CONSUMER ({@link AuthorHandlesDal.applyRename}) against the
 * real Postgres harness. Drives the DAL directly (no HTTP) over a standalone Drizzle client, since the
 * consumer is invoked by an SQS event, not an endpoint. Pins the two properties the sync depends on:
 *
 *   - **Fan-out:** a rename updates the read model AND every owned recipes.author_handle +
 *     recipe_versions.editor_handle, in one transaction.
 *   - **Monotonic + out-of-order safety:** an older-or-equal source_timestamp is ignored; A→B→A redelivered
 *     out of order converges to the actual latest name — so redelivery / cross-route races can't corrupt it.
 *
 * Skips when no test database is configured.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';

import { createRecipeDrizzle } from '../../src/database/client.js';
import { AuthorHandlesDal } from '../../src/authors/dal/authorHandles.dal.js';
import { hasDatabaseUrl } from './harness.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];

const USER = '01JHANDLEE2E0000USER00000A';
const OTHER = '01JHANDLEE2E000OTHER00000B';

describe.skipIf(!hasDatabaseUrl)('handle-sync consumer (integration, real DB)', () => {
    let pool: pg.Pool;
    let dal: AuthorHandlesDal;
    let recipeId: string;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: DATABASE_URL, max: 3 });
        dal = new AuthorHandlesDal(createRecipeDrizzle(pool));
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

    it('applies a rename and fans it out to the owner’s recipes + versions (not other users’)', async () => {
        const applied = await dal.applyRename({
            userId: USER,
            displayName: 'New Name',
            sourceTimestamp: new Date('2026-07-20T00:00:00.000Z'),
        });

        expect(applied).toBe(true);
        expect(await dal.findHandle(USER)).toBe('New Name');
        expect(await handleOf(recipeId)).toBe('New Name');
        expect(await editorOf(recipeId)).toBe('New Name');
        // Another user's recipe is untouched.
        const { rows } = await pool.query<{ author_handle: string }>(
            'SELECT author_handle FROM recipes WHERE owner_id = $1',
            [OTHER],
        );
        expect(rows[0]!.author_handle).toBe('Other Name');
    });

    it('IGNORES an older-or-equal source_timestamp (monotonic guard)', async () => {
        await dal.applyRename({ userId: USER, displayName: 'V2', sourceTimestamp: new Date('2026-07-20T12:00:00Z') });

        const staleApplied = await dal.applyRename({
            userId: USER,
            displayName: 'V1-late',
            sourceTimestamp: new Date('2026-07-20T06:00:00Z'), // older → must be ignored
        });

        expect(staleApplied).toBe(false);
        expect(await dal.findHandle(USER)).toBe('V2');
        expect(await handleOf(recipeId)).toBe('V2');
    });

    it('converges to the actual latest for A→B→A redelivered OUT OF ORDER', async () => {
        const tA1 = new Date('2026-07-20T01:00:00Z');
        const tB = new Date('2026-07-20T02:00:00Z');
        const tA2 = new Date('2026-07-20T03:00:00Z'); // the true latest: back to "Ada"

        // Delivered out of order: the newest (tA2 "Ada") arrives first, then the older ones.
        await dal.applyRename({ userId: USER, displayName: 'Ada', sourceTimestamp: tA2 });
        await dal.applyRename({ userId: USER, displayName: 'Bob', sourceTimestamp: tB });
        await dal.applyRename({ userId: USER, displayName: 'Ada-old', sourceTimestamp: tA1 });

        // The monotonic guard kept the tA2 value regardless of arrival order.
        expect(await dal.findHandle(USER)).toBe('Ada');
        expect(await handleOf(recipeId)).toBe('Ada');
    });
});
