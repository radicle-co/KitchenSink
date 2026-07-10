/**
 * Contract-conformance test for the VERSIONS vertical (DIVERGENCE #2).
 *
 * Drives the REAL `@kitchensink/recipe-service-client` against the REAL booted app so the client's
 * version-addressing contract and the server AGREE end to end. The client addresses a version by its
 * 1-based integer `versionNumber` (`GET/POST …/versions/{versionNumber}`), while the server historically
 * bound `:versionId` with `ParseUUIDPipe` and looked up a row UUID — so every `getRecipeVersion` /
 * `restoreRecipeVersion` 400'd on the integer path. This suite exercises that exact flow (list → get by
 * number → restore by number) and asserts the restore envelope `{ recipe, restoredFromVersion,
 * currentVersion }`; it RED'd on the integer path before the fix.
 *
 * The parent recipe is seeded via raw `fetch` (create-recipe has its own unreconciled divergence, #5).
 * The nested `recipe` inside the restore envelope is asserted at the field level, not full-schema, because
 * the recipe-detail serialization (`RecipeResponse`) has a separate open divergence from `recipe-core`'s
 * `Recipe` (#6). Runs only when the harness DB is configured.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RecipeServiceClient } from '@kitchensink/recipe-service-client';
import { recipeVersionSchema } from '@kitchensink/recipe-core';

import { bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from '../../../tests/e2e/harness.js';

/** The dev-bypass owner ULID this suite creates recipes + versions as. */
const OWNER = '01JVERSIONCONTRACT0000000A';

/** A seeded catalog ingredient (Flour) from the baseline global setup. */
const FLOUR_ID = '00000000-0000-4000-8000-0000000000aa';

describe.skipIf(!hasDatabaseUrl)('versions vertical — client ↔ server contract conformance', () => {
    let booted: BootedRecipeApp;
    let client: RecipeServiceClient;
    let recipeId: string;

    beforeAll(async () => {
        booted = await bootRecipeApp({ devAuthUserId: OWNER });
        client = new RecipeServiceClient({ baseUrl: booted.baseUrl });

        // Seed + edit via raw fetch (test setup). Create-recipe now requires servings + timings
        // (divergence #5, done), but the ingredient-LINE shape still diverges (`name` vs `ingredientName`,
        // etc.), so `client.createRecipe` cannot yet build an accepted body — tracked as divergence #8.
        const createRes = await fetch(`${booted.baseUrl}/v1/recipes`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                title: 'Original Title',
                servings: 2,
                prepTimeMinutes: 5,
                cookTimeMinutes: 10,
                totalTimeMinutes: 15,
                tags: [],
                dietaryFlags: [],
                ingredients: [{ ingredientId: FLOUR_ID, name: 'Flour', quantity: 2, unit: 'cup' }],
                steps: [{ instruction: 'Mix.' }],
            }),
        });
        expect(createRes.status).toBe(201);
        recipeId = ((await createRes.json()) as { id: string }).id;

        // Edit → version 2 exists, so there is a prior version 1 to address + restore.
        const patchRes = await fetch(`${booted.baseUrl}/v1/recipes/${recipeId}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ expectedVersion: 1, title: 'Edited Title' }),
        });
        expect(patchRes.status).toBe(200);
    });

    afterAll(async () => {
        await booted.close();
    });

    it('lists, gets-by-number, and restores-by-number entirely through the typed client', async () => {
        // List → newest-first, addressed by integer versionNumber.
        const versions = await client.listRecipeVersions(recipeId);
        expect(versions.map((version) => version.versionNumber)).toEqual([2, 1]);

        // Get version 1 by its integer number (the call that 400'd against the UUID-bound server).
        const version1 = await client.getRecipeVersion(recipeId, 1);
        expect(recipeVersionSchema.safeParse(version1).success).toBe(true);
        expect(version1.versionNumber).toBe(1);
        expect(version1.snapshot.title).toBe('Original Title');

        // Restore version 1 by number → the envelope { recipe, restoredFromVersion, currentVersion }.
        const restored = await client.restoreRecipeVersion(recipeId, 1);
        expect(restored.restoredFromVersion).toBe(1);
        expect(restored.currentVersion).toBe(3); // create(1) → edit(2) → restore(3)
        expect(restored.recipe.id).toBe(recipeId);
        expect(restored.recipe.title).toBe('Original Title'); // content reverted to v1
    });
});
