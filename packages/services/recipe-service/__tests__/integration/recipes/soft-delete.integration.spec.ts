/**
 * T126 — C-007 / FR-002 soft-delete tombstone integration test (real Nest app + Docker Postgres).
 *
 * Proves the guarantee that separates a soft delete from a hard one: `DELETE /v1/recipes/{id}` hides the
 * recipe from every normal API, but the ROW SURVIVES with `deleted_at` stamped, retained indefinitely
 * until an explicit GDPR erasure (C-007). Nothing else in the suite pins that: `recipes/crud` asserts
 * only 204-then-404, which a hard `DELETE FROM recipes` would satisfy identically — so a regression to a
 * destructive delete would ship green while silently destroying the retention guarantee (and the
 * distinction the erasure flow depends on). Hence the raw, filter-bypassing row read below.
 *
 * Scope note (DRY — one authoritative spec per rule): the sibling exclusion rules already have homes and
 * are NOT re-asserted here — search exclusion in `integration/search/search.integration.spec.ts`
 * ("excludes tombstoned (soft-deleted) recipes from results"), collection-membership exclusion in
 * `integration/collections/crud.integration.spec.ts` ("...excluding tombstoned recipes from the
 * listing"), and GET-after-delete → 404 in `integration/recipes/crud.integration.spec.ts`. What is left —
 * and covered here — is retention, owner-list exclusion, and re-delete idempotency.
 *
 * Runs only when the harness DB is configured — otherwise skipped in lockstep with the global setup.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from '../../../tests/e2e/harness.js';
import { DrizzleProvider } from '../../../src/database/database.module.js';
import type { RecipeDrizzle } from '../../../src/database/client.js';
import { recipes } from '../../../src/database/schema/recipes.js';

/** The dev-bypass owner ULID this suite creates and tombstones recipes as. */
const OWNER = '01JSOFTDELETE0OWNER000000DD';

interface RecipeBody {
    id: string;
    title: string;
}

interface PaginatedBody {
    data: RecipeBody[];
    total: number;
}

const CREATE_PAYLOAD = {
    title: 'Tombstone Test Recipe',
    description: 'Created by the C-007 soft-delete integration spec.',
    servings: 2,
    prepTimeMinutes: 5,
    cookTimeMinutes: 10,
    totalTimeMinutes: 15,
    tags: ['integration'],
    dietaryFlags: [],
    ingredients: [{ ingredientId: '00000000-0000-4000-8000-0000000000aa', name: 'Flour', quantity: 1, unit: 'cup' }],
    steps: [{ instruction: 'Mix.' }],
};

describe.skipIf(!hasDatabaseUrl)('recipe soft-delete tombstones (C-007 integration)', () => {
    let booted: BootedRecipeApp;
    let baseUrl: string;
    let db: RecipeDrizzle;

    beforeAll(async () => {
        booted = await bootRecipeApp({ devAuthUserId: OWNER });
        baseUrl = booted.baseUrl;
        // The app's own Drizzle client, resolved from the container — used ONLY to read rows the DAL's
        // `deleted_at IS NULL` filter deliberately hides, which is exactly what retention needs proven.
        db = booted.app.get<RecipeDrizzle>(DrizzleProvider);
    });

    afterAll(async () => {
        await db.delete(recipes).where(eq(recipes.ownerId, OWNER));
        await booted.close();
    });

    /** Create a recipe over HTTP and return its id. */
    async function createRecipe(title: string): Promise<string> {
        const res = await fetch(`${baseUrl}/v1/recipes`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ...CREATE_PAYLOAD, title }),
        });
        expect(res.status).toBe(201);

        return ((await res.json()) as RecipeBody).id;
    }

    /** Read the row straight from Postgres, bypassing every tombstone filter. */
    async function readRaw(id: string): Promise<{ id: string; deletedAt: Date | null } | undefined> {
        const [row] = await db
            .select({ id: recipes.id, deletedAt: recipes.deletedAt })
            .from(recipes)
            .where(eq(recipes.id, id))
            .limit(1);

        return row;
    }

    it('retains the row with deleted_at stamped — a tombstone, not a destructive delete', async () => {
        const id = await createRecipe('Tombstone Retention');

        const before = await readRaw(id);
        expect(before?.deletedAt).toBeNull();

        const deleteRes = await fetch(`${baseUrl}/v1/recipes/${id}`, { method: 'DELETE' });
        expect(deleteRes.status).toBe(204);

        // THE C-007 guarantee: the row is still there, now carrying a tombstone. A hard delete makes
        // `after` undefined and fails here — while leaving the 204/404 assertions elsewhere green.
        const after = await readRaw(id);
        expect(after).toBeDefined();
        expect(after?.id).toBe(id);
        expect(after?.deletedAt).toBeInstanceOf(Date);
    });

    it("drops the tombstoned recipe from the owner's list while leaving its siblings", async () => {
        const keptId = await createRecipe('Kept In List');
        const doomedId = await createRecipe('Dropped From List');

        const before = (await (await fetch(`${baseUrl}/v1/recipes?page=1&pageSize=50`)).json()) as PaginatedBody;
        expect(before.data.map((r) => r.id)).toEqual(expect.arrayContaining([keptId, doomedId]));

        expect((await fetch(`${baseUrl}/v1/recipes/${doomedId}`, { method: 'DELETE' })).status).toBe(204);

        const after = (await (await fetch(`${baseUrl}/v1/recipes?page=1&pageSize=50`)).json()) as PaginatedBody;
        const ids = after.data.map((r) => r.id);
        expect(ids).not.toContain(doomedId);
        // Asserting the sibling SURVIVES stops a mutation that empties the list wholesale from passing,
        // and pins the paginated `total` to the active set rather than the raw row count.
        expect(ids).toContain(keptId);
        expect(after.total).toBe(before.total - 1);
    });

    it('answers a repeat DELETE with 404 and never moves the original tombstone', async () => {
        const id = await createRecipe('Idempotent Re-delete');

        expect((await fetch(`${baseUrl}/v1/recipes/${id}`, { method: 'DELETE' })).status).toBe(204);
        const firstTombstone = (await readRaw(id))?.deletedAt;
        expect(firstTombstone).toBeInstanceOf(Date);

        // The DAL's `deleted_at IS NULL` guard makes the second delete match zero rows → 404, so the
        // recorded moment of deletion stays put (a re-stamp would falsify the retention audit trail).
        expect((await fetch(`${baseUrl}/v1/recipes/${id}`, { method: 'DELETE' })).status).toBe(404);
        expect((await readRaw(id))?.deletedAt).toEqual(firstTombstone);
    });
});
