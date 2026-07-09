/**
 * T051 — Clone + visibility (US2) integration spec (real Nest app + Docker Postgres via
 * `tests/global-setup.ts`).
 *
 * Drives the `POST /v1/recipes/{id}/clone` and `PATCH /v1/recipes/{id}/visibility` HTTP surfaces end to
 * end against a live database, asserting the invariants the fake-DB unit tests cannot:
 *
 * - **Clone (FR-011)** — attribution is RETAINED for an imported source and RECORDED to the original
 *   author for a `user_created` original; the clone is reassigned to the caller with `cloned_from_id`
 *   pointing at the source, `has_substantive_edit = false`, and the C-004 clone-default visibility; the
 *   ORIGINAL row is left untouched.
 * - **Substantive edit (C-004 / FR-005)** — a content (steps/ingredients) edit over HTTP flips
 *   `has_substantive_edit` to true; a metadata-only edit does not.
 * - **Visibility policy (C-004)** — over HTTP the harness principal is FREE-tier (the dev-auth bypass
 *   injects `permissions: []`), so making a `user_created` recipe private is DENIED (400) while making
 *   it public is allowed. The premium `imported_public → private` unlock is covered exhaustively by the
 *   pure evaluator + service unit tests (`visibility-policy.test.ts`, `substantive-edit*.test.ts`),
 *   since premium cannot be injected through the dev-auth harness.
 *
 * The provenance columns (`source_*`, `cloned_from_id`, `has_substantive_edit`) are not part of the
 * `Recipe` wire response, so those assertions read the row directly via a dedicated Drizzle client.
 * Guarded with `describe.skipIf(!hasDatabaseUrl)` so it is a no-op when the harness is not up.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import pg from 'pg';

import { bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from '../../../tests/e2e/harness.js';
import { createRecipeDrizzle, type RecipeDrizzle } from '../../../src/database/client.js';
import { recipes, recipeSteps, recipeIngredients, type RecipeRow } from '../../../src/database/schema/index.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];

/** The acting (cloning / editing) user — injected as the dev-auth principal (free-tier). */
const CLONER = '01JCLONEOWNERAAAAAAAAAAAAAA';
/** A distinct original author whose PUBLIC recipe the cloner clones. */
const AUTHOR = '01JAUTHOROWNERBBBBBBBBBBBBB';
/** A seeded catalog ingredient (Flour) from the baseline global setup. */
const FLOUR_ID = '00000000-0000-4000-8000-0000000000aa';

interface RecipeBody {
    id: string;
    ownerId: string;
    title: string;
    visibility: string;
    version: number;
    steps: { stepNumber: number; instruction: string }[];
    ingredients: { ingredientId: string }[];
}

/** Insert a full recipe (row + one step + one ingredient link) directly, returning its id. */
async function seedRecipe(
    db: RecipeDrizzle,
    values: Partial<RecipeRow> & { ownerId: string; title: string },
): Promise<string> {
    const [row] = await db
        .insert(recipes)
        .values({ ingredientNamesText: values.title.toLowerCase(), ...values })
        .returning({ id: recipes.id });

    if (!row) {
        throw new Error('recipe insert returned no row');
    }

    await db.insert(recipeSteps).values({ recipeId: row.id, stepNumber: 1, instruction: 'Original step' });
    await db.insert(recipeIngredients).values({
        recipeId: row.id,
        ingredientId: FLOUR_ID,
        ingredientName: 'Flour',
        quantity: '2',
        unit: 'cup',
        sortOrder: 0,
        isUserEntered: true,
    });

    return row.id;
}

/** Read one recipe row directly (for provenance columns absent from the wire response). */
async function readRow(db: RecipeDrizzle, id: string): Promise<RecipeRow> {
    const [row] = await db.select().from(recipes).where(eq(recipes.id, id)).limit(1);

    if (!row) {
        throw new Error(`recipe ${id} not found`);
    }

    return row;
}

describe.skipIf(!hasDatabaseUrl)('Clone + visibility US2 (integration)', () => {
    let booted: BootedRecipeApp;
    let baseUrl: string;
    let pool: pg.Pool;
    let db: RecipeDrizzle;

    beforeAll(async () => {
        booted = await bootRecipeApp({ devAuthUserId: CLONER });
        baseUrl = booted.baseUrl;
        pool = new pg.Pool({ connectionString: DATABASE_URL });
        db = createRecipeDrizzle(pool);
    });

    afterAll(async () => {
        await pool.end();
        await booted.close();
    });

    beforeEach(async () => {
        await db.delete(recipes).where(sql`${recipes.ownerId} IN (${CLONER}, ${AUTHOR})`);
    });

    // The dev-auth bypass reads a PROCESS-GLOBAL `RECIPE_DEV_AUTH_USER_ID` per request, so a test that
    // boots a second app as a different user (e.g. the owner-clones-own imported_paid case) mutates it for
    // the shared primary CLONER app too. Restore the primary user after every test so identity never leaks
    // across cases.
    afterEach(() => {
        process.env['RECIPE_DEV_AUTH_USER_ID'] = CLONER;
    });

    it('clones a PUBLIC user_created original: reassigns owner, links lineage, records author attribution', async () => {
        const sourceId = await seedRecipe(db, {
            ownerId: AUTHOR,
            title: 'Author Public Dish',
            visibility: 'public',
            sourceType: 'user_created',
        });

        const res = await fetch(`${baseUrl}/v1/recipes/${sourceId}/clone`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({}),
        });
        expect(res.status).toBe(201);
        const clone = (await res.json()) as RecipeBody;

        // Owner reassigned to the caller; content copied.
        expect(clone.ownerId).toBe(CLONER);
        expect(clone.id).not.toBe(sourceId);
        expect(clone.title).toBe('Author Public Dish');
        expect(clone.steps).toHaveLength(1);
        expect(clone.ingredients[0]?.ingredientId).toBe(FLOUR_ID);
        // user_created source → clone defaults to public.
        expect(clone.visibility).toBe('public');

        // Provenance (not in the wire response) — read the row directly.
        const cloneRow = await readRow(db, clone.id);
        expect(cloneRow.clonedFromId).toBe(sourceId);
        expect(cloneRow.hasSubstantiveEdit).toBe(false);
        // No source attribution on a user_created original → attribution recorded to the original author.
        expect(cloneRow.sourceAttribution).toContain(AUTHOR);

        // Original is untouched.
        const originalRow = await readRow(db, sourceId);
        expect(originalRow.ownerId).toBe(AUTHOR);
        expect(originalRow.clonedFromId).toBeNull();
    });

    it('retains attribution + private default when cloning an imported_paid source (owner clones own)', async () => {
        // imported_paid is private-only, so only the owner can clone it — act AS the author here.
        const closeAuthorApp = await bootRecipeApp({ devAuthUserId: AUTHOR });

        try {
            const sourceId = await seedRecipe(db, {
                ownerId: AUTHOR,
                title: 'Paid Cookbook Recipe',
                visibility: 'private',
                sourceType: 'imported_paid',
                sourceUrl: 'https://store.example.com/book',
                sourceAttribution: 'Famous Chef',
            });

            const res = await fetch(`${closeAuthorApp.baseUrl}/v1/recipes/${sourceId}/clone`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({}),
            });
            expect(res.status).toBe(201);
            const clone = (await res.json()) as RecipeBody;

            expect(clone.ownerId).toBe(AUTHOR);
            expect(clone.visibility).toBe('private');

            const cloneRow = await readRow(db, clone.id);
            expect(cloneRow.sourceType).toBe('imported_paid');
            expect(cloneRow.sourceUrl).toBe('https://store.example.com/book');
            expect(cloneRow.sourceAttribution).toBe('Famous Chef');
        } finally {
            await closeAuthorApp.close();
        }
    });

    it('a NON-owner cannot clone a PRIVATE recipe (403 NOT_OWNER)', async () => {
        const sourceId = await seedRecipe(db, {
            ownerId: AUTHOR,
            title: 'Author Private Dish',
            visibility: 'private',
            sourceType: 'user_created',
        });

        const res = await fetch(`${baseUrl}/v1/recipes/${sourceId}/clone`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({}),
        });

        expect(res.status).toBe(403);
    });

    it('a content (steps) edit flips has_substantive_edit; a metadata-only edit does not', async () => {
        const contentId = await seedRecipe(db, { ownerId: CLONER, title: 'Editable Dish', sourceType: 'user_created' });
        const metaId = await seedRecipe(db, { ownerId: CLONER, title: 'Rename Only', sourceType: 'user_created' });

        // Content edit → substantive.
        const contentRes = await fetch(`${baseUrl}/v1/recipes/${contentId}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ expectedVersion: 1, steps: [{ instruction: 'A brand new step' }] }),
        });
        expect(contentRes.status).toBe(200);
        expect((await readRow(db, contentId)).hasSubstantiveEdit).toBe(true);

        // Metadata-only edit → NOT substantive.
        const metaRes = await fetch(`${baseUrl}/v1/recipes/${metaId}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ expectedVersion: 1, title: 'Renamed Only' }),
        });
        expect(metaRes.status).toBe(200);
        expect((await readRow(db, metaId)).hasSubstantiveEdit).toBe(false);
    });

    it('free-tier visibility policy: user_created → private is DENIED (400), → public is allowed (200)', async () => {
        const id = await seedRecipe(db, {
            ownerId: CLONER,
            title: 'Visibility Subject',
            visibility: 'public',
            sourceType: 'user_created',
        });

        // Free-tier user_created is public-only → private denied.
        const denied = await fetch(`${baseUrl}/v1/recipes/${id}/visibility`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ visibility: 'private' }),
        });
        expect(denied.status).toBe(400);
        expect((await denied.json()).code).toBe('INVALID_VISIBILITY');

        // Public is always allowed for user_created; visibility unchanged but the call succeeds.
        const allowed = await fetch(`${baseUrl}/v1/recipes/${id}/visibility`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ visibility: 'public' }),
        });
        expect(allowed.status).toBe(200);
        expect((await allowed.json()).visibility).toBe('public');
    });
});
