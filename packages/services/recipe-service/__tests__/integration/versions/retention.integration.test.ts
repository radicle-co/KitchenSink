/**
 * T044 — version retention integration test (real Nest app + Docker Postgres).
 *
 * Drives {@link VersionsService.createSnapshot} against the harness (booted by `bootRecipeApp`, migrated
 * + seeded by `tests/globalSetup.ts`) to prove the FR-007b / FR-007b-i retention behavior end to end AS
 * SHIPPED post-T130: at save time NOTHING is pruned — every version stays in Postgres because the row is
 * the payload the async archive retry replays — and each version beyond the newest 10 is recorded in the
 * `recipe_version_pending_archives` outbox for the version-archive worker to archive-then-prune out of
 * band. Enqueue is idempotent, so a repeated save cannot fan out duplicate archive work. There is no S3
 * assertion here: the S3 write is the worker's job (covered by the recipe-workers archive drain spec),
 * not this save path.
 *
 * Version writes are not yet wired to a recipe-save HTTP path in this vertical, so the spec resolves the
 * real {@link VersionsService} from the Nest container and calls `createSnapshot` directly (12 times) on
 * a recipe it creates over HTTP. Runs only when the harness DB is configured — otherwise skipped in
 * lockstep with the global setup (`describe.skipIf(!hasDatabaseUrl)`).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RecipeSnapshot } from '@kitchensink/recipe-core';

import { eq } from 'drizzle-orm';

import { bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from '../../../tests/e2e/harness.js';
import { DrizzleProvider } from '../../../src/database/database.module.js';
import type { RecipeDrizzle } from '../../../src/database/client.js';
import { recipeVersionPendingArchives } from '../../../src/database/schema/index.js';
import { VersionsService, VERSIONS_DAL } from '../../../src/versions/versions.service.js';
import type { VersionsDal } from '../../../src/versions/dal/versions.dal.js';

/** The dev-bypass owner ULID this suite creates and versions a recipe as. */
const OWNER = '01JVERSIONS0OWNER0000000CC';

interface RecipeBody {
    id: string;
}

const CREATE_PAYLOAD = {
    title: 'Retention Recipe',
    servings: 2,
    prepTimeMinutes: 5,
    cookTimeMinutes: 10,
    totalTimeMinutes: 15,
    ingredients: [
        { ingredientId: '00000000-0000-4000-8000-0000000000cc', name: 'Water', quantity: { kind: 'exact', value: 1 } },
    ],
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

    it('leaves EVERY version in Postgres and records the over-retention ones in the outbox', async () => {
        // Create the golden recipe the versions attach to (recipe_versions.recipe_id is an FK).
        const createRes = await fetch(`${baseUrl}/api/v1/recipes`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(CREATE_PAYLOAD),
        });
        expect(createRes.status).toBe(201);
        const recipe = (await createRes.json()) as RecipeBody;

        const service = booted.app.get(VersionsService);
        const dal = booted.app.get<VersionsDal>(VERSIONS_DAL);
        const db = booted.app.get<RecipeDrizzle>(DrizzleProvider);

        // `create` now records an initial version automatically (verticals-1). Clear it so THIS suite
        // controls the exact version set it seeds below.
        for (const existing of await dal.listByRecipe(recipe.id)) {
            await dal.deleteById(existing.id);
        }

        // Write 12 versions. Retention runs after each write, so versions 1 and 2 go over the limit.
        const total = 12;

        for (let versionNumber = 1; versionNumber <= total; versionNumber += 1) {
            // ⚠️ Inside a real transaction now: `createSnapshot` requires one, because a version row and
            // the recipe write it belongs to commit together (owner ruling 2026-09-06). Driving it in a
            // transaction here keeps the suite exercising the shape production actually uses.
            await db.transaction(async (tx) =>
                service.createSnapshot(
                    {
                        recipeId: recipe.id,
                        versionNumber,
                        snapshot: snapshotAt(versionNumber),
                        createdBy: OWNER,
                    },
                    tx,
                ),
            );
        }

        // T130 cutover: NOTHING is pruned at save time. Every version is still here, because the row is
        // the payload the archive retry replays — it must outlive the save and every failed attempt.
        // Pruning is the archive worker's job, after S3 confirms (archive-before-delete, async).
        const remaining = await dal.listByRecipe(recipe.id);
        expect(remaining).toHaveLength(total);

        // The over-retention versions (1 and 2) are recorded in the outbox instead.
        const pending = await db
            .select({
                recipeVersionId: recipeVersionPendingArchives.recipeVersionId,
                versionNumber: recipeVersionPendingArchives.versionNumber,
                status: recipeVersionPendingArchives.status,
                attempts: recipeVersionPendingArchives.attempts,
            })
            .from(recipeVersionPendingArchives)
            .where(eq(recipeVersionPendingArchives.recipeId, recipe.id));

        expect(pending.map((row) => row.versionNumber).sort((a, b) => a - b)).toEqual([1, 2]);
        // Fresh debts: claimable by the worker/sweeper, nothing attempted yet.
        expect(pending.every((row) => row.status === 'pending')).toBe(true);
        expect(pending.every((row) => row.attempts === 0)).toBe(true);
    });

    it('re-enqueues idempotently, so a repeated save cannot fan out duplicate archive work', async () => {
        const createRes = await fetch(`${baseUrl}/api/v1/recipes`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(CREATE_PAYLOAD),
        });
        const recipe = (await createRes.json()) as RecipeBody;

        const service = booted.app.get(VersionsService);
        const dal = booted.app.get<VersionsDal>(VERSIONS_DAL);
        const db = booted.app.get<RecipeDrizzle>(DrizzleProvider);

        for (const existing of await dal.listByRecipe(recipe.id)) {
            await dal.deleteById(existing.id);
        }

        for (let versionNumber = 1; versionNumber <= 12; versionNumber += 1) {
            // ⚠️ Inside a real transaction now: `createSnapshot` requires one, because a version row and
            // the recipe write it belongs to commit together (owner ruling 2026-09-06). Driving it in a
            // transaction here keeps the suite exercising the shape production actually uses.
            await db.transaction(async (tx) =>
                service.createSnapshot(
                    {
                        recipeId: recipe.id,
                        versionNumber,
                        snapshot: snapshotAt(versionNumber),
                        createdBy: OWNER,
                    },
                    tx,
                ),
            );
        }

        // A 13th save re-derives the SAME over-retention set (1 and 2 are still un-archived) and
        // re-enqueues them. UNIQUE(recipe_version_id) + ON CONFLICT DO NOTHING must absorb that —
        // otherwise every subsequent save would pile up duplicate archive work for the same version.
        await db.transaction(async (tx) =>
            service.createSnapshot(
                {
                    recipeId: recipe.id,
                    versionNumber: 13,
                    snapshot: snapshotAt(13),
                    createdBy: OWNER,
                },
                tx,
            ),
        );

        const pending = await db
            .select({ versionNumber: recipeVersionPendingArchives.versionNumber })
            .from(recipeVersionPendingArchives)
            .where(eq(recipeVersionPendingArchives.recipeId, recipe.id));

        // 13 versions, limit 10 -> versions 1, 2, 3 owe an archive. One row each, no duplicates.
        expect(pending.map((row) => row.versionNumber).sort((a, b) => a - b)).toEqual([1, 2, 3]);
    });
});
