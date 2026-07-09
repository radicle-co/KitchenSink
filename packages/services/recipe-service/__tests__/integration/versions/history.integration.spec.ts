/**
 * verticals-1 — recipe version history actually POPULATES (integration, real booted app + Postgres).
 *
 * Before the fix, a snapshot was written only by `restore`, so `GET …/versions` was always empty and
 * restore always 404'd — a shipped-but-inert feature. Now `RecipesService` records a version on every
 * create/update/clone (via the forwardRef'd `VersionsService`), and restore records exactly ONE new
 * version (the update it drives opts out of auto-snapshotting). This spec drives the real HTTP surface
 * end to end:
 *   create → 1 version; edit → 2 versions (newest-first); restore v1 → content reverts + a 3rd version.
 *
 * It also proves the forwardRef RecipesModule <-> VersionsModule cycle boots. Guarded with
 * `describe.skipIf(!hasDatabaseUrl)` so it is a no-op when the harness is not up.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from '../../../tests/e2e/harness.js';

/** A seeded catalog ingredient (Flour) from the baseline global setup. */
const FLOUR_ID = '00000000-0000-4000-8000-0000000000aa';
const OWNER = '01JVERSIONHISTORYOWNERAAAAA';

interface VersionBody {
    id: string;
    versionNumber: number;
    changeSummary?: string;
}
interface RecipeBody {
    id: string;
    title: string;
    version: number;
}

const CREATE_BODY = {
    title: 'Original Title',
    servings: 2,
    prepTimeMinutes: 5,
    cookTimeMinutes: 10,
    totalTimeMinutes: 15,
    ingredients: [{ ingredientId: FLOUR_ID, name: 'Flour', quantity: 2, unit: 'cup' }],
    steps: [{ instruction: 'Mix the batter.' }],
};

describe.skipIf(!hasDatabaseUrl)('recipe version history populates (integration)', () => {
    let booted: BootedRecipeApp;
    let baseUrl: string;

    beforeAll(async () => {
        booted = await bootRecipeApp({ devAuthUserId: OWNER });
        baseUrl = booted.baseUrl;
    });

    afterAll(async () => {
        await booted.close();
    });

    const listVersions = async (recipeId: string): Promise<VersionBody[]> => {
        const res = await fetch(`${baseUrl}/v1/recipes/${recipeId}/versions`);
        expect(res.status).toBe(200);
        return (await res.json()) as VersionBody[];
    };

    it('records a version on create and on each edit, and restore reverts + records one more', async () => {
        // Create → version 1 exists (history is no longer empty).
        const createRes = await fetch(`${baseUrl}/v1/recipes`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(CREATE_BODY),
        });
        expect(createRes.status).toBe(201);
        const created = (await createRes.json()) as RecipeBody;

        const afterCreate = await listVersions(created.id);
        expect(afterCreate).toHaveLength(1);
        expect(afterCreate[0]?.versionNumber).toBe(1);

        // Edit → version 2, newest-first.
        const patchRes = await fetch(`${baseUrl}/v1/recipes/${created.id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ expectedVersion: 1, title: 'Edited Title' }),
        });
        expect(patchRes.status).toBe(200);

        const afterEdit = await listVersions(created.id);
        expect(afterEdit.map((version) => version.versionNumber)).toEqual([2, 1]);

        // Restore version 1 → content reverts, and EXACTLY ONE new version is recorded (no double).
        const v1 = afterEdit.find((version) => version.versionNumber === 1);
        expect(v1).toBeDefined();
        const restoreRes = await fetch(`${baseUrl}/v1/recipes/${created.id}/versions/${v1!.id}/restore`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({}),
        });
        expect(restoreRes.status).toBe(200);

        // The recipe's title reverted to version 1's content.
        const getRes = await fetch(`${baseUrl}/v1/recipes/${created.id}`);
        const recipe = (await getRes.json()) as RecipeBody;
        expect(recipe.title).toBe('Original Title');

        // Restore added one version (v3) — not two.
        const afterRestore = await listVersions(created.id);
        expect(afterRestore.map((version) => version.versionNumber)).toEqual([3, 2, 1]);
    });
});
