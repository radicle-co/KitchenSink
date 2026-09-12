/**
 * ⛔ Who may reach a recipe's PHOTOS and VERSIONS — pinned over HTTP for a stranger, before and after those
 * verticals stopped authorizing through the recipe DETAIL read.
 *
 * Photos and versions used `RecipesService.getById` as their permission check: it builds the whole detail
 * (photos, rating, catalog, a food lookup, verdicts) and they discarded it. They now use the row-only
 * `findReadableRecipe` / `findOwnedRecipe`. That swap is exactly the kind of change that can quietly
 * re-open an existence oracle or flip a 404 into a 403, and no integration test covered either vertical for a
 * second user — so these were written FIRST, as CHARACTERIZATION tests, and passed against the `getById`
 * implementation before any caller moved. They are the proof that the move preserved the rules:
 *
 *  - a recipe the caller cannot SEE (someone else's private one) answers `404` on every route — the same as a
 *    missing id, so the response never confirms it exists (W8-a.4);
 *  - a recipe the caller CAN see but does not own answers `200` for a read and `403 NOT_OWNER` for a mutation.
 *
 * One booted app, two principals via `asPrincipal` (sequential requests only — it is process-global).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { asPrincipal, bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from '../../../tests/e2e/harness.js';
import { recipeDb } from '../../../tests/support/roleDb.js';

const roleDb = recipeDb();
const OWNER = '01JACCESSOWNER000000000000A';
const STRANGER = '01JACCESSSTRANGER000000000B';

const CREATE_BODY = {
    title: 'Access Recipe',
    servings: 2,
    prepTimeMinutes: 5,
    cookTimeMinutes: 10,
    totalTimeMinutes: 15,
    visibility: 'public',
    tags: [],
    dietaryFlags: [],
    ingredients: [],
    steps: [{ instruction: 'Mix.' }],
    status: 'draft',
};

describe.skipIf(!hasDatabaseUrl)('photos + versions authorize a stranger by the recipe row (integration)', () => {
    let booted: BootedRecipeApp;
    let baseUrl: string;
    let pool: pg.Pool;
    let publicId: string;
    let privateId: string;

    /**
     * Create a recipe as the OWNER and set its visibility directly — a free-tier owner cannot create a private
     * recipe over HTTP, and what is under test here is the stranger's access, not the premium gate.
     *
     * @param visibility - The visibility to leave the recipe in.
     * @returns The recipe id.
     * @sideEffect Creates a recipe and updates its row.
     */
    async function seed(visibility: 'public' | 'private'): Promise<string> {
        const res = await fetch(`${baseUrl}/api/v1/recipes`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(CREATE_BODY),
        });
        expect(res.status).toBe(201);
        const { id } = (await res.json()) as { id: string };

        await pool.query(`UPDATE recipes SET visibility = $1, status = 'published' WHERE id = $2`, [visibility, id]);

        return id;
    }

    /**
     * Issue a request as the STRANGER and return its status.
     *
     * @sideEffect One HTTP request under a flipped dev-auth identity.
     */
    async function asStranger(method: string, path: string, body?: unknown): Promise<number> {
        const res = await asPrincipal(STRANGER, () =>
            fetch(`${baseUrl}${path}`, {
                method,
                headers: { 'content-type': 'application/json' },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            }),
        );

        return res.status;
    }

    beforeAll(async () => {
        booted = await bootRecipeApp({ databaseUrl: roleDb.appUrl, devAuthUserId: OWNER });
        baseUrl = booted.baseUrl;
        pool = new pg.Pool({ connectionString: roleDb.appUrl, max: 2 });
        publicId = await seed('public');
        privateId = await seed('private');
    });

    afterAll(async () => {
        await pool.query('DELETE FROM recipes WHERE owner_id = $1', [OWNER]);
        await pool.end();
        await booted.close();
    });

    const UPLOAD_BODY = { fileName: 'dish.png', contentType: 'image/png', fileSize: 1024 };

    it("GET photos — someone else's PRIVATE recipe is 404, a public one is 200", async () => {
        expect(await asStranger('GET', `/api/v1/recipes/${privateId}/photos`)).toBe(404);
        expect(await asStranger('GET', `/api/v1/recipes/${publicId}/photos`)).toBe(200);
    });

    it("POST photos/upload-url — someone else's PRIVATE recipe is 404, a public one is 403", async () => {
        expect(await asStranger('POST', `/api/v1/recipes/${privateId}/photos/upload-url`, UPLOAD_BODY)).toBe(404);
        expect(await asStranger('POST', `/api/v1/recipes/${publicId}/photos/upload-url`, UPLOAD_BODY)).toBe(403);
    });

    it("GET versions — someone else's PRIVATE recipe is 404, a public one is 200", async () => {
        expect(await asStranger('GET', `/api/v1/recipes/${privateId}/versions`)).toBe(404);
        expect(await asStranger('GET', `/api/v1/recipes/${publicId}/versions`)).toBe(200);
    });

    it("GET versions/1 — someone else's PRIVATE recipe is 404, a public one is 200", async () => {
        expect(await asStranger('GET', `/api/v1/recipes/${privateId}/versions/1`)).toBe(404);
        expect(await asStranger('GET', `/api/v1/recipes/${publicId}/versions/1`)).toBe(200);
    });

    it("POST versions/1/restore — someone else's PRIVATE recipe is 404, a public one is 403", async () => {
        expect(await asStranger('POST', `/api/v1/recipes/${privateId}/versions/1/restore`, {})).toBe(404);
        expect(await asStranger('POST', `/api/v1/recipes/${publicId}/versions/1/restore`, {})).toBe(403);
    });

    it('the OWNER restores their own private recipe — the row read still carries the version it checks', async () => {
        const res = await fetch(`${baseUrl}/api/v1/recipes/${privateId}/versions/1/restore`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({}),
        });

        expect(res.status).toBe(200);
        expect(((await res.json()) as { currentVersion: number }).currentVersion).toBe(2);
    });
});
