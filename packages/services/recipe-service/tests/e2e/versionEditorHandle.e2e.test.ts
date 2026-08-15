/**
 * W6 — end-to-end proof that EVERY version-creating write path stamps the editor's "by @handle"
 * attribution (`recipe_versions.editor_handle`) against the real Postgres harness, not just CREATE.
 *
 * The defect this pins: before the fix, only CREATE threaded `editorHandle`; UPDATE, CLONE and RESTORE
 * recorded their version snapshots with a NULL `editor_handle`, so W6's version-history "by @handle"
 * rendered EMPTY for every edit-created version in production. Here we boot the REAL Nest app against the
 * Docker DB, resolve the REAL services via DI (so we can drive them with a principal that carries name
 * claims — the dev-auth bypass principal deliberately carries none, so `deriveDisplayName` would be blank),
 * exercise create → update → clone → restore, and assert the persisted `editor_handle` is the editor's
 * derived display name on the version each path records — proving the column is NOT NULL and that the read
 * model surfaces it.
 *
 * Skips when no test database is configured (guarded by `hasDatabaseUrl`).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';

import { bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from './harness.js';
import { RecipesService } from '../../src/recipes/recipes.service.js';
import { VersionsService } from '../../src/versions/versions.service.js';
import type { Principal } from '../../src/auth/principal.js';
import type { CreateRecipeDto } from '../../src/recipes/dto/createRecipe.dto.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];

/** A test owner ULID (ownership is the app-user ULID; no FK, so an arbitrary ULID is a valid owner). */
const OWNER = '01JEDITHANDLE0000OWNER0000';
/** A seeded catalog ingredient — recipe create/update validate every line's id against the catalog. */
const FLOUR_ID = '00000000-0000-4000-8000-0000000000aa';

/** A verified principal whose first/last-name claims derive (via the ONE shared rule) to "Clara Oswald". */
const EDITOR: Principal = {
    userId: OWNER,
    sub: 'clerk_editor',
    firstName: 'Clara',
    lastName: 'Oswald',
    scopes: [],
    permissions: [],
};

const CREATE_DTO: CreateRecipeDto = {
    title: 'Editor-Handle E2E',
    servings: 2,
    prepTimeMinutes: 5,
    cookTimeMinutes: 10,
    totalTimeMinutes: 15,
    ingredients: [{ ingredientId: FLOUR_ID, name: 'Flour', quantity: 1 }],
    steps: [{ instruction: 'Mix' }],
};

describe.skipIf(!hasDatabaseUrl)('version editor_handle provenance (e2e, real DB)', () => {
    let booted: BootedRecipeApp;
    let recipes: RecipesService;
    let versions: VersionsService;
    let pool: pg.Pool;

    beforeAll(async () => {
        booted = await bootRecipeApp();
        recipes = booted.app.get(RecipesService);
        versions = booted.app.get(VersionsService);
        pool = new pg.Pool({ connectionString: DATABASE_URL, max: 3 });
    });

    afterAll(async () => {
        await pool.query('DELETE FROM recipes WHERE owner_id = $1', [OWNER]);
        await pool.end();
        await booted.close();
    });

    beforeEach(async () => {
        await pool.query('DELETE FROM recipes WHERE owner_id = $1', [OWNER]);
    });

    /** The persisted `editor_handle` for a given (recipe, versionNumber), read straight from the row. */
    async function editorHandleOf(recipeId: string, versionNumber: number): Promise<string | null> {
        const { rows } = await pool.query<{ editor_handle: string | null }>(
            'SELECT editor_handle FROM recipe_versions WHERE recipe_id = $1 AND version_number = $2',
            [recipeId, versionNumber],
        );

        return rows[0]?.editor_handle ?? null;
    }

    it('stamps the editor handle on the UPDATE-created version (the main W6 defect)', async () => {
        const created = await recipes.create(EDITOR, CREATE_DTO);

        await recipes.update(EDITOR, created.id, { expectedVersion: 1, title: 'Renamed' });

        // The version the edit records must carry the editor's handle — NULL here was the production bug.
        expect(await editorHandleOf(created.id, 2)).toBe('Clara Oswald');
        // And it surfaces on the read model the W6 UI consumes.
        const history = await versions.list(OWNER, created.id);
        expect(history.find((v) => v.versionNumber === 2)?.editorHandle).toBe('Clara Oswald');
    });

    it('stamps the cloner handle on the CLONE-created version', async () => {
        const source = await recipes.create(EDITOR, CREATE_DTO);

        const clone = await recipes.clone(EDITOR, source.id);

        expect(await editorHandleOf(clone.id, 1)).toBe('Clara Oswald');
    });

    it('stamps the restorer handle on the RESTORE-created version', async () => {
        const created = await recipes.create(EDITOR, CREATE_DTO);
        await recipes.update(EDITOR, created.id, { expectedVersion: 1, title: 'Renamed' });

        // Restore version 1 → records a NEW version (3) authored by the restorer.
        const restored = await versions.restore(EDITOR, created.id, 1);

        expect(await editorHandleOf(created.id, restored.currentVersion)).toBe('Clara Oswald');
    });
});
