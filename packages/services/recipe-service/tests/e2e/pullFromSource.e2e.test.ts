/**
 * W8-a.8 / decision 7 — e2e proof of the pull-from-source preview + drift-guarded commit through the
 * fully ASSEMBLED recipe app, against the real Postgres harness:
 *
 *   - **Preview is read-only:** `POST …/pull-from-source/preview` returns the `{ added, removed, unchanged }`
 *     diff and mutates NOTHING — the `recipe_collections` row count is byte-identical before and after.
 *   - **Commit applies** the previewed `added` set when the echoed diff still matches the live one.
 *   - **Drift is a 409:** when the caller removes a recipe from their OWN clone between preview and commit,
 *     re-committing the stale previewed diff returns 409 PULL_DRIFT (with the fresh diff) and does NOT
 *     silently re-add the recipe — the exact lost-intent decision 7 closes.
 *
 * The booted app authenticates as the CLONER (dev bypass). A source collection (public recipes) and the
 * cloner's clone (with source_collection_id set) are seeded via a direct pg pool. Skips without a database.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from './harness.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];

const CLONER = '01JPULLE2E00000CLONER0000A';
const SOURCE_OWNER = '01JPULLE2E00000SOURCE0000B';

interface PullDiff {
    added: string[];
    removed: string[];
    unchanged: string[];
}

describe.skipIf(!hasDatabaseUrl)('pull-from-source preview + drift (e2e, assembled app)', () => {
    let booted: BootedRecipeApp;
    let pool: pg.Pool;
    let sourceId: string;
    let cloneId: string;
    let recA: string;
    let recB: string;

    async function insertRecipe(owner: string, title: string): Promise<string> {
        const { rows } = await pool.query<{ id: string }>(
            `INSERT INTO recipes (owner_id, title, visibility, status, servings, prep_time_minutes, cook_time_minutes, total_time_minutes)
             VALUES ($1, $2, 'public', 'published', 2, 5, 10, 15) RETURNING id`,
            [owner, title],
        );

        return rows[0]!.id;
    }

    async function insertCollection(owner: string, name: string, source: string | null): Promise<string> {
        const { rows } = await pool.query<{ id: string }>(
            `INSERT INTO collections (owner_id, name, visibility, source_collection_id)
             VALUES ($1, $2, 'private', $3) RETURNING id`,
            [owner, name, source],
        );

        return rows[0]!.id;
    }

    async function addMembership(collectionId: string, recipeId: string, via: string): Promise<void> {
        await pool.query(
            `INSERT INTO recipe_collections (collection_id, recipe_id, added_via) VALUES ($1, $2, $3)
             ON CONFLICT DO NOTHING`,
            [collectionId, recipeId, via],
        );
    }

    async function membershipCount(collectionId: string): Promise<number> {
        const { rows } = await pool.query<{ n: string }>(
            'SELECT count(*)::text AS n FROM recipe_collections WHERE collection_id = $1',
            [collectionId],
        );

        return Number(rows[0]!.n);
    }

    beforeAll(async () => {
        booted = await bootRecipeApp({ devAuthUserId: CLONER });
        pool = new pg.Pool({ connectionString: DATABASE_URL, max: 3 });

        recA = await insertRecipe(SOURCE_OWNER, 'Pull E2E recipe A');
        recB = await insertRecipe(SOURCE_OWNER, 'Pull E2E recipe B');

        // Source has {A, B}; the cloner's clone starts with {A} — so a pull will add B.
        sourceId = await insertCollection(SOURCE_OWNER, 'E2E source', null);
        await addMembership(sourceId, recA, 'manual');
        await addMembership(sourceId, recB, 'manual');

        cloneId = await insertCollection(CLONER, 'E2E clone', sourceId);
        await addMembership(cloneId, recA, 'clone_seed');
    });

    afterAll(async () => {
        await pool.query('DELETE FROM collections WHERE owner_id = ANY($1)', [[CLONER, SOURCE_OWNER]]);
        await pool.query('DELETE FROM recipes WHERE owner_id = ANY($1)', [[CLONER, SOURCE_OWNER]]);
        await pool.end();
        await booted?.close();
    });

    it('preview returns the diff and mutates nothing (read-only)', async () => {
        const before = await membershipCount(cloneId);

        const res = await fetch(`${booted.baseUrl}/api/v1/collections/${cloneId}/pull-from-source/preview`, {
            method: 'POST',
        });
        expect(res.status).toBe(200);
        const diff = (await res.json()) as PullDiff;

        expect(diff.added).toEqual([recB]);
        expect(diff.unchanged).toEqual([recA]);
        expect(await membershipCount(cloneId)).toBe(before); // NO write happened
    });

    it('commit with a matching echoed diff applies the added set', async () => {
        const commit = await fetch(`${booted.baseUrl}/api/v1/collections/${cloneId}/pull-from-source`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ previewedDiff: { added: [recB], removed: [], unchanged: [recA] } }),
        });
        expect(commit.status).toBe(200);
        const body = (await commit.json()) as { addedRecipeIds: string[] };
        expect(body.addedRecipeIds).toEqual([recB]);
        expect(await membershipCount(cloneId)).toBe(2); // A + B now
    });

    it('commit with a STALE echoed diff (own-clone drift) is 409 PULL_DRIFT and re-adds nothing', async () => {
        // The cloner deletes A from their own clone; a stale preview still lists A as unchanged.
        await pool.query('DELETE FROM recipe_collections WHERE collection_id = $1 AND recipe_id = $2', [cloneId, recA]);
        const before = await membershipCount(cloneId);

        const commit = await fetch(`${booted.baseUrl}/api/v1/collections/${cloneId}/pull-from-source`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ previewedDiff: { added: [], removed: [], unchanged: [recA, recB] } }),
        });

        expect(commit.status).toBe(409);
        const err = (await commit.json()) as { code: string; details?: { diff: PullDiff } };
        expect(err.code).toBe('PULL_DRIFT');
        expect(err.details?.diff.added).toContain(recA); // fresh diff surfaces A as now-addable
        // Crucially, the deleted recipe was NOT silently re-added.
        expect(await membershipCount(cloneId)).toBe(before);
    });
});
