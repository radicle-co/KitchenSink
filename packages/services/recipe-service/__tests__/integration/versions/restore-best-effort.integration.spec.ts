/**
 * S-R2 — `VersionsService.restore`'s post-update snapshot write is best-effort (real Nest app + Docker
 * Postgres), matching the convention `RecipesService.recordSnapshot` uses for create/update/clone.
 *
 * Before the fix, `restore`'s own `createSnapshot(...)` call (recording the restore's provenance —
 * `baseVersion` + `changeSummary: 'Restored from version N'`) was UN-swallowed: `recipes.update` had
 * already committed the reverted content, so a snapshot-write failure surfaced as a 500 on a restore that
 * had, in fact, already taken effect (state/response divergence, and no version row either).
 *
 * This spec forces that snapshot write to fail for real — not a mock — by pre-inserting a `recipe_versions`
 * row at the EXACT `(recipe_id, version_number)` restore's own snapshot write is about to target, tripping
 * the real `recipe_versions_recipe_version_unique` constraint. It then asserts the restore endpoint STILL
 * returns 200 with the reverted content, proving the best-effort swallow holds at the real-DB boundary, not
 * just against a mocked DAL.
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
    ingredients: [{ ingredientId: FLOUR_ID, name: 'Flour', quantity: 2, unit: 'cup' }],
    steps: [{ instruction: 'Mix the batter.' }],
};

describe.skipIf(!hasDatabaseUrl)('recipe version restore snapshot is best-effort (integration)', () => {
    let booted: BootedRecipeApp;
    let baseUrl: string;

    beforeAll(async () => {
        booted = await bootRecipeApp({ devAuthUserId: OWNER });
        baseUrl = booted.baseUrl;
    });

    afterAll(async () => {
        await booted.close();
    });

    it('restore still returns 200 with reverted content when its own snapshot write hits a real DB conflict', async () => {
        // Create → version 1. `currentVersion` is now 1, so restoring v1 will drive `recipes.update` to
        // `expectedVersion: 1`, bumping `currentVersion` to 2 — restore's own snapshot write will then
        // target `(recipe.id, versionNumber: 2)`.
        const createRes = await fetch(`${baseUrl}/v1/recipes`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(CREATE_BODY),
        });
        expect(createRes.status).toBe(201);
        const created = (await createRes.json()) as RecipeBody;

        const db = booted.app.get<RecipeDrizzle>(DrizzleProvider);

        // Poison version 2 for this recipe BEFORE restoring — a real unique-constraint collision, not a
        // mock, on `recipe_versions_recipe_version_unique (recipe_id, version_number)`. This is exactly
        // the write restore's own `createSnapshot` is about to attempt.
        await db.insert(recipeVersions).values({
            recipeId: created.id,
            versionNumber: 2,
            snapshot: { poisoned: true },
            createdBy: OWNER,
            changeSummary: 'Pre-seeded to collide with the restore snapshot write',
        });

        // Restore version 1. `recipes.update` commits the reverted content; the restore's OWN snapshot
        // write then collides on the unique index and throws — the fix must swallow that, not 500.
        const restoreRes = await fetch(`${baseUrl}/v1/recipes/${created.id}/versions/1/restore`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({}),
        });

        expect(restoreRes.status).toBe(200);
        const restored = (await restoreRes.json()) as {
            recipe: RecipeBody;
            restoredFromVersion: number;
            currentVersion: number;
        };
        expect(restored.restoredFromVersion).toBe(1);
        expect(restored.currentVersion).toBe(2);
        // The recipe update already committed — that is the caller-visible effect, and it must be
        // reflected in the response even though the restore's version-history write failed underneath it.
        expect(restored.recipe.title).toBe('Original Title');

        // The DB agrees: the recipe's live content reverted, independent of the version-history write.
        const getRes = await fetch(`${baseUrl}/v1/recipes/${created.id}`);
        const recipe = (await getRes.json()) as RecipeBody;
        expect(recipe.title).toBe('Original Title');

        // Exactly two rows for this recipe: v1 from `create`, and the pre-seeded poisoned v2 — restore's
        // own snapshot write lost the unique-constraint race and was swallowed, not retried into a
        // duplicate or a differently-numbered row.
        const rows = await db
            .select({ versionNumber: recipeVersions.versionNumber, changeSummary: recipeVersions.changeSummary })
            .from(recipeVersions)
            .where(eq(recipeVersions.recipeId, created.id));
        expect(rows).toHaveLength(2);

        // Version 2 still carries the PRE-SEEDED changeSummary — restore's own write (which would have
        // set `'Restored from version 1'`) never landed.
        const versionTwo = rows.find((row) => row.versionNumber === 2);
        expect(versionTwo?.changeSummary).toBe('Pre-seeded to collide with the restore snapshot write');
    });
});
