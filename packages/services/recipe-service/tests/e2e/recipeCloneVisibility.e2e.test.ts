/**
 * W8-b Task 7 — e2e proof of recipe clone (FR-011) + visibility read-scoping through the fully ASSEMBLED
 * recipe app against the real Postgres harness. The unit/integration tiers already exhaust
 * `RecipesService.clone` / `getById`'s branches; this pins the client-visible HTTP contract.
 *
 * **Clone ownership (verified against `RecipesService.clone`, `src/recipes/recipes.service.ts:742`):** the
 * clone is owned by the CLONER, never the source's author — `ownerId` on the response is the caller, and
 * the clone gets a brand-new `id` distinct from the source's, carried via `clonedFromId`.
 *
 * **Clone default visibility (verified against `defaultCloneVisibility`,
 * `src/recipes/domain/visibilityPolicy.ts:97`):** a clone of a `user_created` (or `imported_public`)
 * source defaults to `public` — NOT a private draft. Only `imported_physical`/`imported_paid` sources
 * clone to `private`. Every recipe seeded in this suite is `user_created` (the DB column default), so
 * every successful clone here is asserted `public`, matching the actual policy rather than assuming one.
 *
 * **IDOR (verified against `RecipesService.clone` + `getById`,
 * `src/recipes/domain/recipeVisibility.ts`):** a source the caller cannot VIEW — private and not their
 * own, OR a public-but-`draft` recipe (W8-a.3's security boundary) — is `404 RECIPE_NOT_FOUND` for both
 * clone and direct GET, indistinguishable from a missing id. Never `403` (which would confirm the id
 * exists) and never `200` (which would leak the content).
 *
 * The booted app authenticates as CLONER (dev bypass); OWNER's source recipes are seeded directly via a
 * raw pg pool (mirroring `ratings.e2e.test.ts`). For the one assertion that needs OWNER to read their OWN
 * recipe (owner GET private = 200), the dev-bypass identity is flipped via `RECIPE_DEV_AUTH_USER_ID`
 * for that single request and restored in a `finally` — the exact pattern `throttle.e2e.test.ts` uses to
 * exercise two authenticated identities against one booted app (the dev bypass reads the env var fresh on
 * every request, so flipping it between sequential — never concurrent — requests is safe). Skips cleanly
 * without a database.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from './harness.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];

const CLONER = '01JCLONEE2E0000CLONER00000A';
const OWNER = '01JCLONEE2E0000OWNER000000B';

interface RecipeBody {
    id: string;
    ownerId: string;
    title: string;
    visibility: string;
    status: string;
    clonedFromId?: string;
    sourceAttribution?: string;
}

interface ApiErrorBody {
    code: string;
    message: string;
}

describe.skipIf(!hasDatabaseUrl)('recipe clone + visibility (e2e, assembled app)', () => {
    let booted: BootedRecipeApp;
    let pool: pg.Pool;

    beforeAll(async () => {
        booted = await bootRecipeApp({ devAuthUserId: CLONER });
        pool = new pg.Pool({ connectionString: DATABASE_URL, max: 3 });
    });

    afterAll(async () => {
        await pool.query('DELETE FROM recipes WHERE owner_id = ANY($1)', [[CLONER, OWNER]]);
        await pool.end();
        await booted?.close();
    });

    async function seedRecipe(
        ownerId: string,
        visibility: 'public' | 'private',
        status: 'draft' | 'published',
        title: string,
    ): Promise<string> {
        const { rows } = await pool.query<{ id: string }>(
            `INSERT INTO recipes (owner_id, title, visibility, status, servings, prep_time_minutes, cook_time_minutes, total_time_minutes)
             VALUES ($1, $2, $3, $4, 2, 5, 10, 15) RETURNING id`,
            [ownerId, title, visibility, status],
        );

        return rows[0]!.id;
    }

    async function clone(id: string): Promise<Response> {
        return fetch(`${booted.baseUrl}/api/v1/recipes/${id}/clone`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({}),
        });
    }

    /**
     * Run `fn` authenticated as `userId` against the ONE booted app, then restore whatever dev-bypass
     * identity was active before — mirrors `throttle.e2e.test.ts`'s "keys the write limit PER USER" test,
     * the established pattern for exercising two identities without booting a second app.
     * @sideEffect Temporarily mutates `process.env['RECIPE_DEV_AUTH_USER_ID']`.
     */
    async function asPrincipal<T>(userId: string, fn: () => Promise<T>): Promise<T> {
        const previous = process.env['RECIPE_DEV_AUTH_USER_ID'];
        process.env['RECIPE_DEV_AUTH_USER_ID'] = userId;

        try {
            return await fn();
        } finally {
            if (previous === undefined) {
                delete process.env['RECIPE_DEV_AUTH_USER_ID'];
            } else {
                process.env['RECIPE_DEV_AUTH_USER_ID'] = previous;
            }
        }
    }

    it('cloning a PUBLIC recipe as another user: 201, owned by the CLONER (not the author), distinct id, public by C-004 default', async () => {
        const sourceId = await seedRecipe(OWNER, 'public', 'published', 'Public Source');

        const res = await clone(sourceId);
        expect(res.status).toBe(201);
        const body = (await res.json()) as RecipeBody;

        // Adversarial: the clone's OWNER is the caller, never the original author.
        expect(body.ownerId).toBe(CLONER);
        expect(body.ownerId).not.toBe(OWNER);
        // A genuinely new row, not the source echoed back.
        expect(body.id).not.toBe(sourceId);
        expect(body.clonedFromId).toBe(sourceId);
        expect(body.title).toBe('Public Source');
        // defaultCloneVisibility(user_created) = public — NOT a private draft.
        expect(body.visibility).toBe('public');
        expect(body.status).toBe('published');
        // No explicit sourceAttribution on the seeded row -> clone attributes to the original owner id.
        expect(body.sourceAttribution).toBe(`Cloned from ${OWNER}`);
    });

    it('cloning a PRIVATE recipe you do not own: 404 RECIPE_NOT_FOUND (IDOR — indistinguishable from a missing id)', async () => {
        const secretId = await seedRecipe(OWNER, 'private', 'published', 'Private Source');

        const res = await clone(secretId);
        expect(res.status).toBe(404);
        expect(((await res.json()) as ApiErrorBody).code).toBe('RECIPE_NOT_FOUND');
    });

    it('cloning a PUBLIC DRAFT you do not own: 404 (the draft boundary applies to clone too, not just visibility)', async () => {
        // A public draft is still owner-only (W8-a.3): visibility alone must NOT be enough to clone it.
        const draftId = await seedRecipe(OWNER, 'public', 'draft', 'Public Draft Source');

        const res = await clone(draftId);
        expect(res.status).toBe(404);
        expect(((await res.json()) as ApiErrorBody).code).toBe('RECIPE_NOT_FOUND');
    });

    it('visibility read-scoping: owner sees their private recipe (200); a non-owner gets 404, never 403 or leaked content', async () => {
        const privateId = await seedRecipe(OWNER, 'private', 'published', 'Owner Only');

        const ownerRead = await asPrincipal(OWNER, () => fetch(`${booted.baseUrl}/api/v1/recipes/${privateId}`));
        expect(ownerRead.status).toBe(200);
        const ownerBody = (await ownerRead.json()) as RecipeBody;
        expect(ownerBody.id).toBe(privateId);
        expect(ownerBody.visibility).toBe('private');

        const nonOwnerRead = await fetch(`${booted.baseUrl}/api/v1/recipes/${privateId}`); // still CLONER
        expect(nonOwnerRead.status).toBe(404);
        expect(((await nonOwnerRead.json()) as ApiErrorBody).code).toBe('RECIPE_NOT_FOUND');
    });

    it('visibility read-scoping: a non-owner CAN see a public, published recipe (200)', async () => {
        const publicId = await seedRecipe(OWNER, 'public', 'published', 'Everyone Can See');

        const res = await fetch(`${booted.baseUrl}/api/v1/recipes/${publicId}`); // CLONER, non-owner
        expect(res.status).toBe(200);
        const body = (await res.json()) as RecipeBody;
        expect(body.id).toBe(publicId);
        expect(body.ownerId).toBe(OWNER);
    });

    it('a freshly-created recipe defaults to public/published (C-004 free-tier default), matching the code', async () => {
        const res = await fetch(`${booted.baseUrl}/api/v1/recipes`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                title: 'Default Visibility E2E',
                servings: 2,
                prepTimeMinutes: 5,
                cookTimeMinutes: 10,
                totalTimeMinutes: 15,
                ingredients: [{ ingredientId: '00000000-0000-4000-8000-0000000000aa', name: 'Flour', quantity: 1 }],
                steps: [{ instruction: 'Mix.' }],
            }),
        });
        expect(res.status).toBe(201);
        const body = (await res.json()) as RecipeBody;
        expect(body.visibility).toBe('public');
        expect(body.status).toBe('published');
        expect(body.ownerId).toBe(CLONER);
    });
});
