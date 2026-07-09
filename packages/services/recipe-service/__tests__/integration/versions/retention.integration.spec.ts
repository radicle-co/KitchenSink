/**
 * T044 — version retention integration test (real Nest app + Docker Postgres + LocalStack S3).
 *
 * Drives {@link VersionsService.createSnapshot} against the harness (booted by `bootRecipeApp`, migrated
 * + seeded by `tests/global-setup.ts`) to prove the FR-007b retention window end to end: Postgres keeps
 * only the newest 10 versions of a recipe, and every version pruned beyond that is archived to the
 * `S3_BUCKET_VERSIONS` bucket in LocalStack (so a snapshot is never lost).
 *
 * Version writes are not yet wired to a recipe-save HTTP path in this vertical, so the spec resolves the
 * real {@link VersionsService} from the Nest container and calls `createSnapshot` directly (12 times) on
 * a recipe it creates over HTTP. Runs only when the harness DB is configured — otherwise skipped in
 * lockstep with the global setup (`describe.skipIf(!hasDatabaseUrl)`).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RecipeSnapshot } from '@kitchensink/recipe-core';

import { bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from '../../../tests/e2e/harness.js';
import { VersionsService, VERSIONS_DAL, versionArchiveKey } from '../../../src/versions/versions.service.js';
import type { VersionsDal } from '../../../src/versions/dal/versions.dal.js';
import type { RecipeVersionRow } from '../../../src/database/schema/index.js';

/** The dev-bypass owner ULID this suite creates and versions a recipe as. */
const OWNER = '01JVERSIONS0OWNER0000000CC';

/** LocalStack S3 endpoint + the version-archive bucket the harness provisions. */
const S3_ENDPOINT = process.env['S3_ENDPOINT'] ?? 'http://localhost:4566';
const VERSIONS_BUCKET = process.env['S3_BUCKET_VERSIONS'] ?? 'commise-versions';

interface RecipeBody {
    id: string;
}

const CREATE_PAYLOAD = {
    title: 'Retention Recipe',
    servings: 2,
    prepTimeMinutes: 5,
    cookTimeMinutes: 10,
    totalTimeMinutes: 15,
    ingredients: [{ ingredientId: '00000000-0000-4000-8000-0000000000cc', name: 'Water', quantity: 1 }],
    steps: [{ instruction: 'Boil.' }],
};

/** A schema-valid snapshot at a given version number. */
function snapshotAt(versionNumber: number): RecipeSnapshot {
    return {
        version: versionNumber,
        title: `Retention Recipe v${versionNumber}`,
        description: '',
        steps: [],
        ingredients: [],
        servings: 2,
        prepTimeMinutes: 5,
        cookTimeMinutes: 10,
    };
}

describe.skipIf(!hasDatabaseUrl)('recipe version retention (integration)', () => {
    let booted: BootedRecipeApp;
    let baseUrl: string;

    beforeAll(async () => {
        booted = await bootRecipeApp({ devAuthUserId: OWNER });
        baseUrl = booted.baseUrl;
    });

    afterAll(async () => {
        await booted.close();
    });

    it('keeps the newest 10 versions in Postgres and archives pruned versions to S3', async () => {
        // Create the golden recipe the versions attach to (recipe_versions.recipe_id is an FK).
        const createRes = await fetch(`${baseUrl}/v1/recipes`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(CREATE_PAYLOAD),
        });
        expect(createRes.status).toBe(201);
        const recipe = (await createRes.json()) as RecipeBody;

        const service = booted.app.get(VersionsService);
        const dal = booted.app.get<VersionsDal>(VERSIONS_DAL);

        // Write 12 versions. Retention runs after each write, so versions 1 and 2 are pruned.
        const total = 12;
        for (let versionNumber = 1; versionNumber <= total; versionNumber += 1) {
            await service.createSnapshot({
                recipeId: recipe.id,
                versionNumber,
                snapshot: snapshotAt(versionNumber),
                createdBy: OWNER,
            });
        }

        // Postgres retains exactly the newest 10 (versions 3..12).
        const remaining = await dal.listByRecipe(recipe.id);
        expect(remaining).toHaveLength(10);
        const remainingVersions = remaining.map((row) => row.versionNumber).sort((a, b) => a - b);
        expect(remainingVersions).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

        // The pruned versions (1 and 2) were archived to the versions bucket in LocalStack.
        for (const prunedVersion of [1, 2]) {
            const key = versionArchiveKey({
                recipeId: recipe.id,
                versionNumber: prunedVersion,
            } as unknown as RecipeVersionRow);
            const archiveRes = await fetch(`${S3_ENDPOINT}/${VERSIONS_BUCKET}/${key}`);
            expect(archiveRes.status).toBe(200);
            const archived = (await archiveRes.json()) as { recipeId: string; versionNumber: number };
            expect(archived.recipeId).toBe(recipe.id);
            expect(archived.versionNumber).toBe(prunedVersion);
        }
    });
});
