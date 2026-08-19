/**
 * e2e proof of the "you cannot edit someone else's recipe" clause (FR-005 / W8-a.4) over REAL HTTP through
 * the fully ASSEMBLED recipe app against the Postgres harness.
 *
 * **Why this file exists.** The clause was proven ONLY at the unit tier (`src/recipes/__tests__/recipes.service.test.ts`,
 * against a STUBBED DAL), so nothing exercised it through the controller, the auth middleware, the
 * `ParseUUIDPipe`/`ZodValidationPipe` chain, or `ApiExceptionFilter`'s domain-error → status mapping. A mocked
 * DAL cannot answer the only question that matters to a client: what status comes back, and — the half a
 * status assertion still misses — **whether the row survived**. A `403` that nevertheless wrote is exactly the
 * failure worth catching, and it is invisible to every tier that does not read the row back. The sibling
 * proofs at this tier are `collections.e2e.test.ts` ("ownership boundary…") and `ratings.e2e.test.ts`; recipes
 * were the one resource missing one.
 *
 * **The 403/404 split is NOT the collections rule, and that is deliberate** (verified against
 * `RecipesService.assertOwner`, `src/recipes/recipes.service.ts`). A collection owned by someone else is always
 * `403 NOT_OWNER`. A RECIPE's answer depends on whether the caller may SEE it:
 *
 *   - a recipe the caller CAN view (public + published, other owner) → `403 NOT_OWNER` — you can see it, you
 *     just cannot modify it, so confirming its existence leaks nothing;
 *   - a recipe the caller CANNOT view (private, or public-but-`draft`, other owner) → `404 RECIPE_NOT_FOUND`,
 *     indistinguishable from a missing id. A bare owner check answering `403` here would be an existence
 *     ORACLE over ids that leak through `clonedFromId`, collection embeds and version references.
 *
 * Both halves are asserted, because asserting only one would leave the other free to drift into the leak.
 *
 * The booted app authenticates as INTRUDER (dev bypass); OWNER's recipes are seeded directly via a raw pg
 * pool — the established pattern here (`ratings.e2e.test.ts`, `recipeCloneVisibility.e2e.test.ts`) — since the
 * boundary is symmetric and OWNER never needs their own session. Skips cleanly without a database.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from './harness.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];

/** The authenticated caller — owns nothing in this suite. */
const INTRUDER = '01JOWNE2E0INTRUDER0000000A';
/** The other user, whose recipes are seeded directly and must survive every attempt below. */
const OWNER = '01JOWNE2E0OWNER0000000000B';

interface ApiErrorBody {
    code: string;
    message: string;
}

/** The persisted row's mutable surface, read back to prove a rejected write wrote NOTHING. */
interface RecipeRowSnapshot {
    title: string;
    visibility: string;
    current_version: number;
    deleted_at: Date | null;
}

describe.skipIf(!hasDatabaseUrl)('recipe ownership boundary (e2e, assembled app)', () => {
    let booted: BootedRecipeApp;
    let pool: pg.Pool;

    beforeAll(async () => {
        booted = await bootRecipeApp({ devAuthUserId: INTRUDER });
        pool = new pg.Pool({ connectionString: DATABASE_URL, max: 3 });
    });

    afterAll(async () => {
        await pool.query('DELETE FROM recipes WHERE owner_id = ANY($1)', [[INTRUDER, OWNER]]);
        await pool.end();
        await booted?.close();
    });

    async function seedOwnerRecipe(visibility: 'public' | 'private', status: 'draft' | 'published', title: string) {
        const { rows } = await pool.query<{ id: string }>(
            `INSERT INTO recipes (owner_id, title, visibility, status, servings, prep_time_minutes, cook_time_minutes, total_time_minutes)
             VALUES ($1, $2, $3, $4, 2, 5, 10, 15) RETURNING id`,
            [OWNER, title, visibility, status],
        );

        return rows[0]!.id;
    }

    /** Read the row's mutable surface straight from Postgres — never through the API that just refused. */
    async function snapshot(id: string): Promise<RecipeRowSnapshot> {
        const { rows } = await pool.query<RecipeRowSnapshot>(
            'SELECT title, visibility, current_version, deleted_at FROM recipes WHERE id = $1',
            [id],
        );

        expect(rows).toHaveLength(1);

        return rows[0]!;
    }

    function patchTitle(id: string): Promise<Response> {
        return fetch(`${booted.baseUrl}/api/v1/recipes/${id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            // A WELL-FORMED body carrying the row's real `expectedVersion`, so a rejection can only come from
            // the ownership check — never from validation or an optimistic-concurrency miss standing in for it.
            body: JSON.stringify({ expectedVersion: 1, title: 'HIJACKED' }),
        });
    }

    function deleteRecipe(id: string): Promise<Response> {
        return fetch(`${booted.baseUrl}/api/v1/recipes/${id}`, { method: 'DELETE' });
    }

    function patchVisibility(id: string): Promise<Response> {
        return fetch(`${booted.baseUrl}/api/v1/recipes/${id}/visibility`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ visibility: 'private' }),
        });
    }

    it("another user's PUBLIC recipe: PATCH / DELETE / PATCH visibility are all 403 NOT_OWNER, and the row is untouched", async () => {
        const id = await seedOwnerRecipe('public', 'published', 'Not Yours (public)');
        const before = await snapshot(id);

        // The caller CAN read it — that is what makes 403 (not 404) the right answer here.
        const read = await fetch(`${booted.baseUrl}/api/v1/recipes/${id}`);
        expect(read.status).toBe(200);

        const patched = await patchTitle(id);
        expect(patched.status).toBe(403);
        expect(((await patched.json()) as ApiErrorBody).code).toBe('NOT_OWNER');

        const visibility = await patchVisibility(id);
        expect(visibility.status).toBe(403);
        expect(((await visibility.json()) as ApiErrorBody).code).toBe('NOT_OWNER');

        const deleted = await deleteRecipe(id);
        expect(deleted.status).toBe(403);
        expect(((await deleted.json()) as ApiErrorBody).code).toBe('NOT_OWNER');

        // THE ASSERTION THAT EARNS THIS FILE: rejected, not silently applied. A 403 that still wrote —
        // renamed, re-scoped, version-bumped or tombstoned — is the defect no status assertion can see.
        expect(await snapshot(id)).toEqual(before);
        expect(before.title).toBe('Not Yours (public)');
        expect(before.deleted_at).toBeNull();
    });

    it("another user's PRIVATE recipe: PATCH / DELETE / PATCH visibility are 404 RECIPE_NOT_FOUND (no existence oracle), and the row is untouched", async () => {
        const id = await seedOwnerRecipe('private', 'published', 'Not Yours (private)');
        const before = await snapshot(id);

        const patched = await patchTitle(id);
        expect(patched.status).toBe(404);
        expect(((await patched.json()) as ApiErrorBody).code).toBe('RECIPE_NOT_FOUND');

        const visibility = await patchVisibility(id);
        expect(visibility.status).toBe(404);
        expect(((await visibility.json()) as ApiErrorBody).code).toBe('RECIPE_NOT_FOUND');

        const deleted = await deleteRecipe(id);
        expect(deleted.status).toBe(404);
        expect(((await deleted.json()) as ApiErrorBody).code).toBe('RECIPE_NOT_FOUND');

        expect(await snapshot(id)).toEqual(before);

        // The oracle proof: a recipe that does not exist AT ALL answers byte-identically, so a probe cannot
        // tell "someone else's private recipe" from "no such id".
        const absent = await patchTitle('00000000-0000-4000-8000-00000000dead');
        expect(absent.status).toBe(404);
        expect(((await absent.json()) as ApiErrorBody).code).toBe('RECIPE_NOT_FOUND');
    });

    it("another user's PUBLIC DRAFT: 404 RECIPE_NOT_FOUND (a draft is not viewable, so it must not be confirmed), and the row is untouched", async () => {
        const id = await seedOwnerRecipe('public', 'draft', 'Not Yours (public draft)');
        const before = await snapshot(id);

        const patched = await patchTitle(id);
        expect(patched.status).toBe(404);
        expect(((await patched.json()) as ApiErrorBody).code).toBe('RECIPE_NOT_FOUND');

        const deleted = await deleteRecipe(id);
        expect(deleted.status).toBe(404);
        expect(((await deleted.json()) as ApiErrorBody).code).toBe('RECIPE_NOT_FOUND');

        expect(await snapshot(id)).toEqual(before);
    });
});
