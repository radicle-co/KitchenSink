/**
 * Restoring a recipe version through the fully assembled app, a real Postgres and a food-service fake (plan 002 R52;
 * LOCAL e2e under the 2026-09-20 ruling).
 *
 * A version froze each line's binding id and, where the saving cook could share it, the line's name. At restore time
 * the binding may still stand, may point at a food that is gone or withdrawn, or may be gone itself. Each case below
 * saves version 1, changes the world, then restores version 1 and reads what the line became:
 *
 * - a binding that still stands, on a live food or a declared name → restored exactly;
 * - a withdrawn or gone food with a frozen name → found again by that name;
 * - a gone food with no frozen name → kept, and shown as removed;
 * - an unresolved line → its name is resolved again, which may succeed now;
 * - a binding that is gone → by its frozen name (a declared line is declared again);
 * - a binding that is gone with no name → the whole restore is refused (409), and nothing changes.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { asPrincipal, bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from './harness.js';
import { bearerFor, startFoodFake, type FoodFake } from '../support/foodFake.js';
import { deleteBindingsMatching } from '../support/bindingCleanup.js';
import { recipeE2eDb } from '../support/roleDb.js';

const roleDb = recipeE2eDb();

const SCOPE = 'e2e-restore';
const AUTHOR = '01JRESTOREE2E00000AUTHOR00';

interface LineBody {
    readonly ingredientId: string;
    readonly name?: string;
    readonly foodId?: string;
    readonly isUserEntered: boolean;
    readonly resolutionStatus?: string;
}

interface RecipeBody {
    readonly id: string;
    readonly currentVersion: number;
    readonly ingredients: readonly LineBody[];
}

let booted: BootedRecipeApp;
let pool: pg.Pool;
let food: FoodFake;
let spareLookup: string;

async function call(method: string, path: string, body?: unknown): Promise<Response> {
    return asPrincipal(AUTHOR, () =>
        fetch(`${booted.baseUrl}${path}`, {
            method,
            headers: { authorization: bearerFor(AUTHOR), 'content-type': 'application/json' },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
    );
}

async function json<T>(method: string, path: string, expected: number, body?: unknown): Promise<T> {
    const response = await call(method, path, body);
    const text = await response.text();

    if (response.status !== expected) {
        throw new Error(`${method} ${path} answered ${response.status}, expected ${expected}: ${text}`);
    }

    return JSON.parse(text) as T;
}

async function byFood(foodId: string): Promise<string> {
    return (await json<{ id: string }>('POST', '/api/v1/ingredients/by-food', 200, { foodId })).id;
}

const line = (ingredientId: string) => ({ ingredientId, quantity: { kind: 'exact', value: 1 }, unit: 'cup' });

/** Save version 1 with `lookupId` on its only line, then move the line to the spare binding (version 2). */
async function savedThenMoved(label: string, lookupId: string): Promise<RecipeBody> {
    const created = await json<RecipeBody>('POST', '/api/v1/recipes', 201, {
        title: `${SCOPE} ${label}`,
        servings: 2,
        prepTimeMinutes: 5,
        cookTimeMinutes: 10,
        totalTimeMinutes: 15,
        ingredients: [line(lookupId)],
        steps: [{ instruction: 'Cook.' }],
    });

    return json<RecipeBody>('PATCH', `/api/v1/recipes/${created.id}`, 200, {
        expectedVersion: created.currentVersion,
        ingredients: [line(spareLookup)],
    });
}

async function restoreVersionOne(recipe: RecipeBody): Promise<RecipeBody> {
    return (await json<{ recipe: RecipeBody }>('POST', `/api/v1/recipes/${recipe.id}/versions/1/restore`, 200)).recipe;
}

/** Delete a binding no line uses any more, and its failure record if it has one. */
async function deleteBinding(lookupId: string): Promise<void> {
    const { rows } = await pool.query<{ unresolved_food_id: string | null }>(
        `DELETE FROM food_lookups WHERE id = $1 RETURNING unresolved_food_id`,
        [lookupId],
    );
    const failure = rows[0]?.unresolved_food_id ?? null;

    if (failure !== null) {
        await pool.query(`DELETE FROM unresolved_foods WHERE id = $1`, [failure]);
    }
}

describe.skipIf(!hasDatabaseUrl)('restoring a version (e2e, assembled app + food fake)', () => {
    beforeAll(async () => {
        food = await startFoodFake();
        food.foods.set(`${SCOPE}-spare`, { name: 'Salt', status: 'RESOLVED' });
        process.env['FOOD_SERVICE_URL'] = food.origin;

        booted = await bootRecipeApp({ databaseUrl: roleDb.appUrl, devAuthUserId: AUTHOR });
        pool = new pg.Pool({ connectionString: roleDb.appUrl, max: 3 });
        spareLookup = await byFood(`${SCOPE}-spare`);
    });

    afterAll(async () => {
        if (pool !== undefined) {
            await pool.query(`DELETE FROM recipes WHERE owner_id = $1`, [AUTHOR]);
            await deleteBindingsMatching(pool, `${SCOPE}%`);
            await pool.end();
        }

        await booted?.close();
        await food?.close();
    });

    it('restores a live food’s binding exactly', async () => {
        food.foods.set(`${SCOPE}-live`, { name: `${SCOPE} Live food`, status: 'RESOLVED' });
        const lookup = await byFood(`${SCOPE}-live`);

        const restored = await restoreVersionOne(await savedThenMoved('live', lookup));

        expect(restored.ingredients[0]).toMatchObject({ ingredientId: lookup, name: `${SCOPE} Live food` });
    });

    it('finds a WITHDRAWN food’s replacement by the frozen name', async () => {
        food.foods.set(`${SCOPE}-old-oats`, { name: `${SCOPE} Oats`, status: 'RESOLVED' });
        const lookup = await byFood(`${SCOPE}-old-oats`);
        const recipe = await savedThenMoved('withdrawn', lookup);

        food.foods.set(`${SCOPE}-old-oats`, { name: `${SCOPE} Oats`, status: 'WITHDRAWN' });
        food.foods.set(`${SCOPE}-new-oats`, { name: `${SCOPE} Oats`, status: 'RESOLVED' });
        food.names.set(`${SCOPE} oats`, `${SCOPE}-new-oats`);

        const restored = await restoreVersionOne(recipe);

        expect(restored.ingredients[0]).toMatchObject({ foodId: `${SCOPE}-new-oats`, name: `${SCOPE} Oats` });
    });

    it('keeps a gone food’s binding when nothing was frozen to find it by, and shows it removed', async () => {
        // The cook's own private food: its name is never frozen into a version, which every reader can see.
        food.foods.set(`${SCOPE}-own`, { name: `${SCOPE} My blend`, status: 'RESOLVED', ownerId: AUTHOR });
        const lookup = await byFood(`${SCOPE}-own`);
        const recipe = await savedThenMoved('gone, nameless', lookup);

        food.foods.delete(`${SCOPE}-own`);

        const restored = await restoreVersionOne(recipe);

        expect(restored.ingredients[0]).toMatchObject({ ingredientId: lookup, resolutionStatus: 'FOOD_REMOVED' });
        expect(restored.ingredients[0]).not.toHaveProperty('name');
    });

    it('restores a declared line exactly', async () => {
        const lookup = (await json<{ id: string }>('POST', '/api/v1/ingredients', 201, { name: `${SCOPE} Nan’s mix` }))
            .id;

        const restored = await restoreVersionOne(await savedThenMoved('declared', lookup));

        expect(restored.ingredients[0]).toMatchObject({ ingredientId: lookup, isUserEntered: true });
    });

    it('resolves an unresolved line’s name again — and binds it when food has it now', async () => {
        const lookup = (
            await json<{ id: string }>('POST', '/api/v1/ingredients/by-name', 202, { name: `${SCOPE} Yuzu` })
        ).id;
        const recipe = await savedThenMoved('unresolved', lookup);

        food.foods.set(`${SCOPE}-yuzu`, { name: `${SCOPE} Yuzu`, status: 'RESOLVED' });
        food.names.set(`${SCOPE} yuzu`, `${SCOPE}-yuzu`);

        const restored = await restoreVersionOne(recipe);

        expect(restored.ingredients[0]).toMatchObject({ foodId: `${SCOPE}-yuzu`, name: `${SCOPE} Yuzu` });
    });

    it('declares a gone declared line again under its frozen name', async () => {
        const lookup = (await json<{ id: string }>('POST', '/api/v1/ingredients', 201, { name: `${SCOPE} Gran’s rub` }))
            .id;
        const recipe = await savedThenMoved('declared, gone', lookup);

        await deleteBinding(lookup);

        const restored = await restoreVersionOne(recipe);

        expect(restored.ingredients[0]).toMatchObject({ name: `${SCOPE} Gran’s rub`, isUserEntered: true });
        expect(restored.ingredients[0]?.ingredientId).not.toBe(lookup);
    });

    it('⛔ refuses the whole restore (409) when a line has no binding and no name — and changes nothing', async () => {
        food.foods.set(`${SCOPE}-own-2`, { name: `${SCOPE} Another blend`, status: 'RESOLVED', ownerId: AUTHOR });
        const lookup = await byFood(`${SCOPE}-own-2`);
        const recipe = await savedThenMoved('gone, nameless, unbound', lookup);

        await deleteBinding(lookup);

        const response = await call('POST', `/api/v1/recipes/${recipe.id}/versions/1/restore`);
        const current = await json<RecipeBody>('GET', `/api/v1/recipes/${recipe.id}`, 200);

        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({ code: 'VERSION_LINE_UNRESTORABLE', details: { positions: [0] } });
        expect(current.currentVersion).toBe(recipe.currentVersion);
        expect(current.ingredients[0]?.ingredientId).toBe(spareLookup);
    });
});
