/**
 * T051 — Clone + visibility (US2) integration spec (real Nest app + Docker Postgres via
 * `tests/globalSetup.ts`).
 *
 * Drives the `POST /api/v1/recipes/{id}/clone` and `PATCH /api/v1/recipes/{id}/visibility` HTTP surfaces end to
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
 *   pure evaluator + service unit tests (`visibilityPolicy.test.ts`, `substantive-edit*.test.ts`),
 *   since premium cannot be injected through the dev-auth harness.
 *
 * The provenance columns (`source_*`, `cloned_from_id`, `has_substantive_edit`) are not part of the
 * `Recipe` wire response, so those assertions read the row directly via a dedicated Drizzle client.
 * Guarded with `describe.skipIf(!hasDatabaseUrl)` so it is a no-op when the harness is not up.
 *
 * Food-service is the in-process fake (`tests/support/foodFake.ts`): since plan 002 a bound line's name comes
 * from food's `refs/resolve`, asked with the caller's own bearer, and food shows a private food to its author
 * only. Every request therefore forwards the bearer of the same user the dev-auth bypass authenticates.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import pg from 'pg';

import { bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from '../../../tests/e2e/harness.js';
import { createRecipeDrizzle, type RecipeDrizzle } from '../../../src/database/client.js';
import { recipes, recipeSteps, type RecipeRow } from '../../../src/database/schema/index.js';
import { bearerFor, startFoodFake, type FoodFake } from '../../../tests/support/foodFake.js';
import { deleteBindingsMatching } from '../../../tests/support/bindingCleanup.js';
import { ensureFoodLookup, insertIngredientLine } from '../../../tests/support/lineChain.js';
import { recipeDb } from '../../../tests/support/roleDb.js';

const roleDb = recipeDb();

/** The acting (cloning / editing) user — injected as the dev-auth principal (free-tier). */
const CLONER = '01JCLONEOWNERAAAAAAAAAAAAAA';
/** A distinct original author whose PUBLIC recipe the cloner clones. */
const AUTHOR = '01JAUTHOROWNERBBBBBBBBBBBBB';
/** A seeded declared binding (Flour) from the baseline global setup. */
const FLOUR_ID = '00000000-0000-4000-8000-0000000000aa';

/** The AUTHOR's two private authored foods, and the bindings the source lines hold them through. */
const PRIVATE_FOOD_PREFIX = '01JU13CLONEPRIVFOOD';
const PRIVATE_FOOD = { lookupId: '00000000-0000-4000-8000-0000c10de001', foodId: `${PRIVATE_FOOD_PREFIX}000001` };
const OWN_FOOD = { lookupId: '00000000-0000-4000-8000-0000c10de002', foodId: `${PRIVATE_FOOD_PREFIX}000002` };

interface RecipeBody {
    id: string;
    ownerId: string;
    title: string;
    visibility: string;
    currentVersion: number;
    steps: { stepNumber: number; instruction: string }[];
    ingredients: {
        ingredientId: string;
        name?: string;
        foodId?: string;
        isUserEntered?: boolean;
        resolutionStatus?: string;
    }[];
    clonePrivateFoodLineCount?: number;
}

/** Insert a full recipe (row + one step + one ingredient line) directly, returning its id. */
async function seedRecipe(
    db: RecipeDrizzle,
    pool: pg.Pool,
    values: Partial<RecipeRow> & { ownerId: string; title: string },
): Promise<string> {
    const [row] = await db
        .insert(recipes)
        .values({
            servings: 1,
            prepTimeMinutes: 5,
            cookTimeMinutes: 10,
            totalTimeMinutes: 15,
            ingredientNamesText: values.title.toLowerCase(),
            ...values,
        })
        .returning({ id: recipes.id });

    if (!row) {
        throw new Error('recipe insert returned no row');
    }

    await db.insert(recipeSteps).values({ recipeId: row.id, stepNumber: 1, instruction: 'Original step' });
    await insertIngredientLine(pool, { recipeId: row.id, foodLookupId: FLOUR_ID, quantity: '2', unit: 'cup' });

    return row.id;
}

/** The first version's stored snapshot lines — what history froze, read from the row rather than a route. */
async function firstVersionLines(pool: pg.Pool, recipeId: string): Promise<Record<string, unknown>[]> {
    const { rows } = await pool.query<{ snapshot: { ingredients: Record<string, unknown>[] } }>(
        'SELECT snapshot FROM recipe_versions WHERE recipe_id = $1 AND version_number = 1',
        [recipeId],
    );

    return rows[0]?.snapshot.ingredients ?? [];
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
    let food: FoodFake;

    beforeAll(async () => {
        food = await startFoodFake();
        process.env['FOOD_SERVICE_URL'] = food.origin;

        booted = await bootRecipeApp({ databaseUrl: roleDb.appUrl, devAuthUserId: CLONER });
        baseUrl = booted.baseUrl;
        pool = new pg.Pool({ connectionString: roleDb.appUrl });
        db = createRecipeDrizzle(pool);
    });

    afterAll(async () => {
        // Lines cascade from their recipes; the bindings go last because a line holds them under `RESTRICT`.
        await db.delete(recipes).where(sql`${recipes.ownerId} IN (${CLONER}, ${AUTHOR})`);
        await deleteBindingsMatching(pool, `${PRIVATE_FOOD_PREFIX}%`);
        await pool.end();
        await booted.close();
        await food.close();
        delete process.env['FOOD_SERVICE_URL'];
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
        const sourceId = await seedRecipe(db, pool, {
            ownerId: AUTHOR,
            title: 'Author Public Dish',
            visibility: 'public',
            sourceType: 'user_created',
        });

        const res = await fetch(`${baseUrl}/api/v1/recipes/${sourceId}/clone`, {
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
        const closeAuthorApp = await bootRecipeApp({ databaseUrl: roleDb.appUrl, devAuthUserId: AUTHOR });

        try {
            const sourceId = await seedRecipe(db, pool, {
                ownerId: AUTHOR,
                title: 'Paid Cookbook Recipe',
                visibility: 'private',
                sourceType: 'imported_paid',
                sourceUrl: 'https://store.example.com/book',
                sourceAttribution: 'Famous Chef',
            });

            const res = await fetch(`${closeAuthorApp.baseUrl}/api/v1/recipes/${sourceId}/clone`, {
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

    // W8-a.4 (IDOR): clone is an owner-only verb over a viewability-gated read. A recipe the caller CANNOT
    // SEE — a PRIVATE one, OR a public DRAFT (a free-tier draft is `visibility='public'`, so status is the
    // real boundary) — owned by someone else must be INDISTINGUISHABLE from a missing id: 404
    // RECIPE_NOT_FOUND, NEVER 403 NOT_OWNER. A 403 here would confirm the id exists and expose its status —
    // the exact existence/status oracle the contract closes. Both not-viewable shapes are asserted so a
    // regression on either (e.g. `status` dropped from the projection) is caught.
    it('a NON-owner CANNOT clone a not-viewable recipe: 404 RECIPE_NOT_FOUND, not a 403 oracle (private + public-draft)', async () => {
        const privateId = await seedRecipe(db, pool, {
            ownerId: AUTHOR,
            title: 'Author Private Dish',
            visibility: 'private',
            sourceType: 'user_created',
        });
        const publicDraftId = await seedRecipe(db, pool, {
            ownerId: AUTHOR,
            title: 'Author Public Draft',
            visibility: 'public',
            status: 'draft',
            sourceType: 'user_created',
        });

        for (const notViewableId of [privateId, publicDraftId]) {
            const res = await fetch(`${baseUrl}/api/v1/recipes/${notViewableId}/clone`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({}),
            });

            expect(res.status).toBe(404);
            expect((await res.json()).code).toBe('RECIPE_NOT_FOUND');
        }
    });

    it('a content (steps) edit flips has_substantive_edit; a metadata-only edit does not', async () => {
        const contentId = await seedRecipe(db, pool, {
            ownerId: CLONER,
            title: 'Editable Dish',
            sourceType: 'user_created',
        });
        const metaId = await seedRecipe(db, pool, {
            ownerId: CLONER,
            title: 'Rename Only',
            sourceType: 'user_created',
        });

        // Content edit → substantive.
        const contentRes = await fetch(`${baseUrl}/api/v1/recipes/${contentId}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ expectedVersion: 1, steps: [{ instruction: 'A brand new step' }] }),
        });
        expect(contentRes.status).toBe(200);
        expect((await readRow(db, contentId)).hasSubstantiveEdit).toBe(true);

        // Metadata-only edit → NOT substantive.
        const metaRes = await fetch(`${baseUrl}/api/v1/recipes/${metaId}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ expectedVersion: 1, title: 'Renamed Only' }),
        });
        expect(metaRes.status).toBe(200);
        expect((await readRow(db, metaId)).hasSubstantiveEdit).toBe(false);
    });

    it('free-tier visibility policy: user_created → private is DENIED (400), → public is allowed (200)', async () => {
        const id = await seedRecipe(db, pool, {
            ownerId: CLONER,
            title: 'Visibility Subject',
            visibility: 'public',
            sourceType: 'user_created',
        });

        // Free-tier user_created is public-only → private denied.
        const denied = await fetch(`${baseUrl}/api/v1/recipes/${id}/visibility`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ visibility: 'private' }),
        });
        expect(denied.status).toBe(400);
        expect((await denied.json()).code).toBe('INVALID_VISIBILITY');

        // Public is always allowed for user_created; visibility unchanged but the call succeeds.
        const allowed = await fetch(`${baseUrl}/api/v1/recipes/${id}/visibility`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ visibility: 'public' }),
        });
        expect(allowed.status).toBe(200);
        expect((await allowed.json()).visibility).toBe('public');
    });

    // ADV-3 / FR-003: the C-004 gate must fire on CREATE too (not only set-visibility) — otherwise a
    // free-tier caller can POST a `private` recipe and bypass the policy. If the create gate is removed,
    // the first request 201s with a private row and this test fails.
    it('free-tier CREATE with visibility:private is DENIED (400 INVALID_VISIBILITY); no row is written', async () => {
        const createBody = {
            title: 'Sneaky Private Create',
            servings: 1,
            prepTimeMinutes: 1,
            cookTimeMinutes: 1,
            totalTimeMinutes: 2,
            ingredients: [{ ingredientId: FLOUR_ID, quantity: { kind: 'exact', value: 1 }, unit: 'cup' }],
            steps: [{ instruction: 'Mix' }],
        };

        const denied = await fetch(`${baseUrl}/api/v1/recipes`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ...createBody, visibility: 'private' }),
        });
        expect(denied.status).toBe(400);
        expect((await denied.json()).code).toBe('INVALID_VISIBILITY');

        // The gate runs before persistence — the free-tier caller (CLONER) owns no such private row.
        const [{ count }] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(recipes)
            .where(sql`${recipes.ownerId} = ${CLONER} AND ${recipes.title} = 'Sneaky Private Create'`);
        expect(count).toBe(0);

        // The same create with public (the free-tier-allowed value) succeeds.
        const allowed = await fetch(`${baseUrl}/api/v1/recipes`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ...createBody, visibility: 'public' }),
        });
        expect(allowed.status).toBe(201);
        expect((await allowed.json()).visibility).toBe('public');
    });
    // ── U13: clone of a private-food line (R20) — the binding is KEPT and no name leaks ────────────────

    /**
     * Seed the AUTHOR's public recipe carrying a second line bound to one of the AUTHOR's private foods, which the
     * food fake holds under `name`, readable by the AUTHOR only.
     */
    async function seedPrivateFoodSource(
        privateFood: typeof PRIVATE_FOOD,
        name: string,
        title: string,
    ): Promise<string> {
        await ensureFoodLookup(pool, {
            arm: 'private',
            foodId: privateFood.foodId,
            ownerId: AUTHOR,
            id: privateFood.lookupId,
        });
        food.foods.set(privateFood.foodId, { name, status: 'RESOLVED', ownerId: AUTHOR });

        const sourceId = await seedRecipe(db, pool, {
            ownerId: AUTHOR,
            title,
            visibility: 'public',
            status: 'published',
            sourceType: 'user_created',
        });

        await insertIngredientLine(pool, {
            recipeId: sourceId,
            foodLookupId: privateFood.lookupId,
            quantity: '1',
            unit: 'cup',
            sortOrder: 1,
        });

        return sourceId;
    }

    /** The clone row's search text, which every reader of a public recipe can match against. */
    async function searchTextOf(recipeId: string): Promise<string> {
        return (await readRow(db, recipeId)).ingredientNamesText;
    }

    /**
     * ⚠️ REWRITTEN (plan 002). This case used to assert the clone UNBOUND the line: a different ingredient id, a
     * freeform user-entered copy. Plan 002 inverts that — a clone KEEPS every binding, including one to another
     * author's private food, because the recipe database no longer stores a name that a kept binding could leak.
     * What the cloner must not get is the NAME, anywhere: not on the line (it reads `RESOLVED_UNAVAILABLE`, with no
     * name and no food id), not in the clone's search text, and not frozen into the clone's first version.
     * `clonePrivateFoodLineCount` keeps its wire name and now counts the lines bound to a food the cloner may not see.
     */
    it("U13: cloning a recipe with ANOTHER author's private-food line KEEPS the binding and leaks no name", async () => {
        const sourceId = await seedPrivateFoodSource(PRIVATE_FOOD, 'Grandma Blend', 'Clone unbind source');

        const response = await fetch(`${baseUrl}/api/v1/recipes/${sourceId}/clone`, {
            method: 'POST',
            headers: { authorization: bearerFor(CLONER) },
        });

        expect(response.status).toBe(201);

        const clone = (await response.json()) as RecipeBody;

        // The banner's number: exactly the lines bound to a food the cloner may not see.
        expect(clone.clonePrivateFoodLineCount).toBe(1);

        const privateLine = clone.ingredients[1];

        // ⛔ The SAME binding — a clone keeps it.
        expect(privateLine?.ingredientId).toBe(PRIVATE_FOOD.lookupId);
        expect(privateLine?.resolutionStatus).toBe('RESOLVED_UNAVAILABLE');
        expect(privateLine?.isUserEntered).toBe(false);
        // ⛔ …and neither its name nor its food id reaches the cloner.
        expect(privateLine).not.toHaveProperty('name');
        expect(privateLine).not.toHaveProperty('foodId');

        // The positive control on the same response: the ordinary line is named, so the absence above is the
        // privacy rule and not a read that names nothing.
        expect(clone.ingredients[0]).toMatchObject({ ingredientId: FLOUR_ID, name: 'Flour' });

        // ⛔ Nor in the two recipe-level surfaces every reader can reach. The declared line's name IS there.
        const searchText = await searchTextOf(clone.id);

        expect(searchText).toContain('Flour');
        expect(searchText.toLowerCase()).not.toContain('grandma');

        const versionLines = await firstVersionLines(pool, clone.id);

        expect(versionLines).toHaveLength(2);
        expect(versionLines[0]).toMatchObject({ ingredientId: FLOUR_ID, ingredientName: 'Flour' });
        expect(versionLines[1]).toMatchObject({ ingredientId: PRIVATE_FOOD.lookupId });
        expect(versionLines[1]).not.toHaveProperty('ingredientName');
    });

    /**
     * ⚠️ REWRITTEN (plan 002) alongside the case above. The author still keeps the binding and sees the food's
     * name on the read — which is also the positive control proving the fake DOES name the private food to its
     * author, so the stranger's missing name above is the privacy rule and not an unnamed fixture. New in plan
     * 002: even the author's own clone stores no private name in its search text or its first version, because
     * both are readable by every reader of the recipe (AE10).
     */
    it('U13: the food AUTHOR cloning their OWN recipe keeps the binding and sees the name — but stores it nowhere shared', async () => {
        const sourceId = await seedPrivateFoodSource(OWN_FOOD, 'Own Blend', 'Own clone source');
        const closeAuthorApp = await bootRecipeApp({ databaseUrl: roleDb.appUrl, devAuthUserId: AUTHOR });

        try {
            const response = await fetch(`${closeAuthorApp.baseUrl}/api/v1/recipes/${sourceId}/clone`, {
                method: 'POST',
                headers: { authorization: bearerFor(AUTHOR) },
            });

            expect(response.status).toBe(201);

            const clone = (await response.json()) as RecipeBody;

            expect(clone.clonePrivateFoodLineCount ?? 0).toBe(0);
            expect(clone.ingredients[1]).toMatchObject({
                ingredientId: OWN_FOOD.lookupId,
                name: 'Own Blend',
                foodId: OWN_FOOD.foodId,
            });
            expect(clone.ingredients[1]?.resolutionStatus).not.toBe('RESOLVED_UNAVAILABLE');

            expect((await searchTextOf(clone.id)).toLowerCase()).not.toContain('own blend');
            expect((await firstVersionLines(pool, clone.id))[1]).not.toHaveProperty('ingredientName');
        } finally {
            await closeAuthorApp.close();
        }
    });
});
