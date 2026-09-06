/**
 * ⛔ A RESTORE THAT CANNOT RECORD ITS VERSION DOES NOT HAPPEN (owner ruling 2026-09-06). Real Nest app,
 * real Docker Postgres.
 *
 * ⚠️ REWRITTEN, and the behaviour it asserted is deliberately gone. This file used to prove the OPPOSITE:
 * that a restore returned 200 with reverted content even when its own snapshot write collided, because
 * `recipes.update` had already committed. Read plainly, that was a restore reported as done with no record
 * that it happened — the same silent hole `create`/`update`/`clone` had, on the one path whose entire
 * purpose is reconstructing history.
 *
 * Two things changed. The restore no longer writes its own version at all: it states a `SnapshotDirective`
 * and `RecipesService.update` records it in the SAME transaction as the content write. And that write is
 * no longer swallowed. So a collision now rolls the content back with it.
 *
 * The failure is induced the same way as before and is worth keeping for it: a real
 * `recipe_versions_recipe_version_unique` collision, pre-seeded at the exact `(recipe_id, version_number)`
 * the restore will target. No mock, no stubbed DAL — a real constraint on the real path, which is the only
 * way to observe whether two writes share a transaction.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from '../../../tests/e2e/harness.js';
import { DrizzleProvider } from '../../../src/database/database.module.js';
import type { RecipeDrizzle } from '../../../src/database/client.js';
import { recipeVersions } from '../../../src/database/schema/index.js';

/** A seeded catalog ingredient (Flour) from the baseline global setup. */
const FLOUR_ID = '00000000-0000-4000-8000-0000000000aa';
const OWNER = '01JVERSIONRESTOREBESTEFFORT';

interface RecipeBody {
    id: string;
    title: string;
}

const CREATE_BODY = {
    title: 'Original Title',
    servings: 2,
    prepTimeMinutes: 5,
    cookTimeMinutes: 10,
    totalTimeMinutes: 15,
    ingredients: [{ ingredientId: FLOUR_ID, name: 'Flour', quantity: { kind: 'exact', value: 2 }, unit: 'cup' }],
    steps: [{ instruction: 'Mix the batter.' }],
};

describe.skipIf(!hasDatabaseUrl)('a restore and its version row are atomic (integration)', () => {
    let booted: BootedRecipeApp;
    let baseUrl: string;

    beforeAll(async () => {
        booted = await bootRecipeApp({ devAuthUserId: OWNER });
        baseUrl = booted.baseUrl;
    });

    afterAll(async () => {
        await booted.close();
    });

    it('⛔ leaves the recipe UNTOUCHED when the restore version row collides', async () => {
        // Create → version 1. `currentVersion` is 1, so restoring v1 drives an update to
        // `expectedVersion: 1`, bumping to 2 — and the version row will target `(recipe.id, 2)`.
        const createRes = await fetch(`${baseUrl}/api/v1/recipes`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(CREATE_BODY),
        });
        expect(createRes.status).toBe(201);
        const created = (await createRes.json()) as RecipeBody;

        const db = booted.app.get<RecipeDrizzle>(DrizzleProvider);

        // Rename first, so there is a live title distinguishable from the restore target. If the restore
        // partially applied, THIS is the value that would have been overwritten.
        const renameRes = await fetch(`${baseUrl}/api/v1/recipes/${created.id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ expectedVersion: 1, title: 'Renamed Before Restore' }),
        });
        expect(renameRes.status).toBe(200);

        // Poison the version number the restore's own row will take — a real unique-constraint collision
        // on `recipe_versions_recipe_version_unique (recipe_id, version_number)`.
        await db.insert(recipeVersions).values({
            recipeId: created.id,
            versionNumber: 3,
            snapshot: { poisoned: true },
            createdBy: OWNER,
            changeSummary: 'Pre-seeded to collide with the restore version row',
        });

        const restoreRes = await fetch(`${baseUrl}/api/v1/recipes/${created.id}/versions/1/restore`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({}),
        });

        // The restore FAILS rather than reporting a success it could not record.
        expect(restoreRes.status).toBeGreaterThanOrEqual(500);

        // ⛔ AND THE CONTENT DID NOT MOVE. This is the half a thrown error alone would not give: without a
        // shared transaction the update commits and only the version row fails, leaving a recipe that was
        // silently restored behind a 500.
        const getRes = await fetch(`${baseUrl}/api/v1/recipes/${created.id}`);
        const recipe = (await getRes.json()) as RecipeBody & { currentVersion: number };

        expect(recipe.title, 'the restore partially applied — content moved despite the failure').toBe(
            'Renamed Before Restore',
        );
        expect(recipe.currentVersion, 'the version was bumped despite the failure').toBe(2);

        // Version history is exactly what it was: v1 from create, v2 from the rename, and the poisoned v3.
        const rows = await db
            .select({ versionNumber: recipeVersions.versionNumber, changeSummary: recipeVersions.changeSummary })
            .from(recipeVersions)
            .where(eq(recipeVersions.recipeId, created.id));

        expect(rows.map((row) => row.versionNumber).sort((a, b) => a - b)).toStrictEqual([1, 2, 3]);
        expect(rows.find((row) => row.versionNumber === 3)?.changeSummary).toBe(
            'Pre-seeded to collide with the restore version row',
        );
    });
});
