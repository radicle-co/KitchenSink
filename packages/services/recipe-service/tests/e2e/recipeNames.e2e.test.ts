/**
 * Recipe line names through the fully assembled app, a real Postgres and a food-service fake (plan 002 R9, R45,
 * AE10; LOCAL e2e under the 2026-09-20 ruling).
 *
 * The recipe database stores no food names. Every name here is derived at read time — from food's answer for a
 * bound line, from the failure record for a declared one — and these cases prove it end to end: over HTTP, through
 * the real repository, and against a fake that answers only what food's published schemas allow.
 *
 * Callers act by the dev-auth bypass (`asPrincipal`) and forward their own bearer, which the fake reads as the
 * caller: food shows a private food to its author only.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { bootRecipeApp, type BootedRecipeApp } from './harness.js';
import { asPrincipal } from '../support/asPrincipal.js';
import { bearerFor, startFoodFake, type FoodFake } from '../support/foodFake.js';
import { deleteBindingsMatching } from '../support/bindingCleanup.js';
import { recipeDb } from '../support/roleDb.js';

const roleDb = recipeDb();

const SCOPE = 'e2e-names';
const AUTHOR = '01JNAMESE2E00000000AUTHOR0';
const STRANGER = '01JNAMESE2E0000000STRANGR0';
const SHARED_FOOD = `${SCOPE}-shared-food`;
const PRIVATE_FOOD = `${SCOPE}-private-food`;

/** A recipe line as the detail read returns it. */
interface LineBody {
    readonly ingredientId: string;
    readonly name?: string;
    readonly foodId?: string;
    readonly unresolvedReason?: string;
    readonly isUserEntered: boolean;
    readonly resolutionStatus?: string;
}

/** A recipe body as the create and detail reads return it. */
interface RecipeBody {
    readonly id: string;
    readonly ingredients?: readonly LineBody[];
    readonly steps?: readonly unknown[];
}

let booted: BootedRecipeApp;
let pool: pg.Pool;
let food: FoodFake;
let sharedLookup: string;
let privateLookup: string;
let declaredLookup: string;
let recipeId: string;

/** Send one request as `userId`, forwarding their bearer to food. */
async function call(userId: string, method: string, path: string, body?: unknown): Promise<Response> {
    return asPrincipal(userId, () =>
        fetch(`${booted.baseUrl}${path}`, {
            method,
            headers: { authorization: bearerFor(userId), 'content-type': 'application/json' },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
    );
}

/** Send one request and parse its JSON body, failing loudly on an unexpected status. */
async function json<T>(userId: string, method: string, path: string, expected: number, body?: unknown): Promise<T> {
    const response = await call(userId, method, path, body);
    const text = await response.text();

    if (response.status !== expected) {
        throw new Error(`${method} ${path} answered ${response.status}, expected ${expected}: ${text}`);
    }

    return JSON.parse(text) as T;
}

/** A one-step recipe with one line per binding, created by the author. */
async function createRecipe(title: string, lookupIds: readonly string[]): Promise<RecipeBody> {
    return json<RecipeBody>(AUTHOR, 'POST', '/api/v1/recipes', 201, {
        title: `${SCOPE} ${title}`,
        servings: 2,
        prepTimeMinutes: 5,
        cookTimeMinutes: 10,
        totalTimeMinutes: 15,
        ingredients: lookupIds.map((ingredientId) => ({
            ingredientId,
            quantity: { kind: 'exact', value: 100 },
            unit: 'g',
        })),
        steps: [{ instruction: 'Cook.' }],
    });
}

/** The line bound to `lookupId` in a detail body. */
function lineOn(recipe: RecipeBody, lookupId: string): LineBody | undefined {
    return recipe.ingredients?.find((line) => line.ingredientId === lookupId);
}

describe('recipe line names (e2e, assembled app + food fake)', () => {
    beforeAll(async () => {
        food = await startFoodFake();
        food.foods.set(SHARED_FOOD, { name: 'Beef brisket', status: 'RESOLVED', caloriesPer100g: 250 });
        food.foods.set(PRIVATE_FOOD, { name: 'Grandma’s rub', status: 'RESOLVED', ownerId: AUTHOR });
        process.env['FOOD_SERVICE_URL'] = food.origin;

        booted = await bootRecipeApp({ databaseUrl: roleDb.appUrl, devAuthUserId: AUTHOR });
        pool = new pg.Pool({ connectionString: roleDb.appUrl, max: 3 });

        sharedLookup = (
            await json<{ id: string }>(AUTHOR, 'POST', '/api/v1/ingredients/by-food', 200, { foodId: SHARED_FOOD })
        ).id;
        privateLookup = (
            await json<{ id: string }>(AUTHOR, 'POST', '/api/v1/ingredients/by-food', 200, { foodId: PRIVATE_FOOD })
        ).id;
        declaredLookup = (
            await json<{ id: string }>(AUTHOR, 'POST', '/api/v1/ingredients', 201, { name: `${SCOPE} spice mix` })
        ).id;
        recipeId = (await createRecipe('three arms', [sharedLookup, privateLookup, declaredLookup])).id;
    });

    afterAll(async () => {
        if (pool !== undefined) {
            await pool.query(`DELETE FROM recipes WHERE owner_id = ANY($1)`, [[AUTHOR, STRANGER]]);
            await deleteBindingsMatching(pool, `${SCOPE}%`);
            await pool.end();
        }

        await booted?.close();
        await food?.close();
    });

    it('names each arm for its author: food’s name for a bound line, the record’s for a declared one', async () => {
        const detail = await json<RecipeBody>(AUTHOR, 'GET', `/api/v1/recipes/${recipeId}`, 200);

        expect(lineOn(detail, sharedLookup)).toMatchObject({
            name: 'Beef brisket',
            foodId: SHARED_FOOD,
            isUserEntered: false,
        });
        expect(lineOn(detail, privateLookup)).toMatchObject({ name: 'Grandma’s rub', foodId: PRIVATE_FOOD });
        expect(lineOn(detail, declaredLookup)).toMatchObject({
            name: `${SCOPE} spice mix`,
            isUserEntered: true,
            unresolvedReason: 'author_declared',
        });
    });

    it('⛔ shows a stranger the private line as unavailable — no name and no food id (AE10)', async () => {
        const detail = await json<RecipeBody>(STRANGER, 'GET', `/api/v1/recipes/${recipeId}`, 200);
        const line = lineOn(detail, privateLookup);

        expect(line?.resolutionStatus).toBe('RESOLVED_UNAVAILABLE');
        expect(line).not.toHaveProperty('name');
        expect(line).not.toHaveProperty('foodId');
        // The positive control on the same read: the shared line is named for the stranger.
        expect(lineOn(detail, sharedLookup)?.name).toBe('Beef brisket');
    });

    it('⛔ indexes and freezes only names every reader may see — never the private food’s', async () => {
        const { rows: recipeRows } = await pool.query<{ text: string }>(
            `SELECT ingredient_names_text AS text FROM recipes WHERE id = $1`,
            [recipeId],
        );
        const { rows: versionRows } = await pool.query<{
            snapshot: { ingredients: { ingredientId: string; ingredientName?: string; isUserEntered: boolean }[] };
        }>(`SELECT snapshot FROM recipe_versions WHERE recipe_id = $1 ORDER BY version_number LIMIT 1`, [recipeId]);
        const frozen = versionRows[0]?.snapshot.ingredients ?? [];

        expect(recipeRows[0]?.text).toContain('Beef brisket');
        expect(recipeRows[0]?.text).toContain('spice mix');
        expect(recipeRows[0]?.text).not.toContain('rub');
        expect(frozen.find((line) => line.ingredientId === sharedLookup)?.ingredientName).toBe('Beef brisket');
        expect(frozen.find((line) => line.ingredientId === privateLookup)).not.toHaveProperty('ingredientName');
        expect(frozen.find((line) => line.ingredientId === declaredLookup)).toMatchObject({
            ingredientName: `${SCOPE} spice mix`,
            isUserEntered: true,
        });
    });

    it('saves during a food outage, with the search text degraded and the bound line unreachable on read', async () => {
        food.down = true;

        try {
            const created = await createRecipe('during an outage', [sharedLookup, declaredLookup]);
            const { rows } = await pool.query<{ text: string }>(
                `SELECT ingredient_names_text AS text FROM recipes WHERE id = $1`,
                [created.id],
            );

            expect(rows[0]?.text).toBe(`${SCOPE} spice mix`);
            expect(lineOn(created, sharedLookup)).toMatchObject({ resolutionStatus: 'FOOD_UNREACHABLE' });
            expect(lineOn(created, sharedLookup)).not.toHaveProperty('name');
        } finally {
            food.down = false;
        }
    });

    it('lists recipes with NO lines and no steps, while the detail carries them', async () => {
        const list = await json<{ data: RecipeBody[] }>(AUTHOR, 'GET', '/api/v1/recipes?pageSize=50', 200);
        const item = list.data.find((recipe) => recipe.id === recipeId);

        expect(item).toBeDefined();
        expect(item).not.toHaveProperty('ingredients');
        expect(item).not.toHaveProperty('steps');
        expect((await json<RecipeBody>(AUTHOR, 'GET', `/api/v1/recipes/${recipeId}`, 200)).ingredients).toHaveLength(3);
    });

    it('searches food’s catalog for the bound foods, named from food, a private one for its author only', async () => {
        const search = (userId: string, q: string) =>
            json<{ id: string; name?: string; foodId?: string }[]>(
                userId,
                'GET',
                `/api/v1/ingredients/search?q=${encodeURIComponent(q)}`,
                200,
            );

        expect(await search(STRANGER, 'brisket')).toStrictEqual([
            expect.objectContaining({ id: sharedLookup, name: 'Beef brisket', foodId: SHARED_FOOD }),
        ]);
        expect(await search(AUTHOR, 'rub')).toStrictEqual([
            expect.objectContaining({ id: privateLookup, name: 'Grandma’s rub', foodId: PRIVATE_FOOD }),
        ]);
        expect(await search(STRANGER, 'rub')).toStrictEqual([]);
    });

    it('⛔ answers 502 SOURCE_UNAVAILABLE for a search while food is down — never a "no match" 200 []', async () => {
        food.down = true;

        try {
            const response = await call(AUTHOR, 'GET', '/api/v1/ingredients/search?q=brisket');

            expect(response.status).toBe(502);
            expect(await response.json()).toMatchObject({ code: 'SOURCE_UNAVAILABLE' });
        } finally {
            food.down = false;
        }
    });

    it('⛔ filters by food id over HTTP — a stranger filtering on the private food finds nothing (R45)', async () => {
        const ids = async (userId: string, foodId: string): Promise<string[]> => {
            const page = await json<{ results: { recipe: { id: string } }[] }>(
                userId,
                'GET',
                `/api/v1/search/recipes?foodIds=${foodId}&pageSize=50`,
                200,
            );

            return page.results.map((hit) => hit.recipe.id);
        };

        expect(await ids(STRANGER, SHARED_FOOD)).toContain(recipeId);
        expect(await ids(AUTHOR, PRIVATE_FOOD)).toContain(recipeId);
        expect(await ids(STRANGER, PRIVATE_FOOD)).not.toContain(recipeId);
    });
});
