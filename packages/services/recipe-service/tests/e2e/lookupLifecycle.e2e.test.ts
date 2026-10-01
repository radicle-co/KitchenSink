/**
 * The life of a line's binding, through the fully assembled app, a real Postgres and a food-service fake (plan 002
 * R13, R14, AE7, AE8, AE19; LOCAL e2e under the 2026-09-20 ruling).
 *
 * The repository's own guarantees are proven one layer down (`foodLookupsDal.e2e.test.ts`). These cases prove what
 * a cook sees over HTTP: two cooks converge on one binding for one food and on one failure for one unmatched name,
 * but never on one declared name; a settled failure moves every line and deletes nothing; one cook's pick never
 * moves another cook's line; and removing a line never removes a binding someone else uses.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { asPrincipal, bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from './harness.js';
import { bearerFor, startFoodFake, type FoodFake } from '../support/foodFake.js';
import { deleteBindingsMatching } from '../support/bindingCleanup.js';
import { recipeE2eDb } from '../support/roleDb.js';

const roleDb = recipeE2eDb();

const SCOPE = 'e2e-lifecycle';
const COOK_A = '01JLIFECYCLEE2E0000COOKA0';
const COOK_B = '01JLIFECYCLEE2E0000COOKB0';

interface RecipeBody {
    readonly id: string;
    readonly currentVersion: number;
    readonly ingredients: readonly { readonly ingredientId: string; readonly name?: string }[];
}

let booted: BootedRecipeApp;
let pool: pg.Pool;
let food: FoodFake;

async function call(userId: string, method: string, path: string, body?: unknown): Promise<Response> {
    return asPrincipal(userId, () =>
        fetch(`${booted.baseUrl}${path}`, {
            method,
            headers: { authorization: bearerFor(userId), 'content-type': 'application/json' },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
    );
}

async function json<T>(userId: string, method: string, path: string, expected: number, body?: unknown): Promise<T> {
    const response = await call(userId, method, path, body);
    const text = await response.text();

    if (response.status !== expected) {
        throw new Error(`${method} ${path} answered ${response.status}, expected ${expected}: ${text}`);
    }

    return JSON.parse(text) as T;
}

const idOf = async (promise: Promise<{ id: string }>): Promise<string> => (await promise).id;

async function recipeOn(userId: string, label: string, lookupIds: readonly string[]): Promise<RecipeBody> {
    return json<RecipeBody>(userId, 'POST', '/api/v1/recipes', 201, {
        title: `${SCOPE} ${label}`,
        servings: 2,
        prepTimeMinutes: 5,
        cookTimeMinutes: 10,
        totalTimeMinutes: 15,
        ingredients: lookupIds.map((ingredientId) => ({
            ingredientId,
            quantity: { kind: 'exact', value: 1 },
            unit: 'cup',
        })),
        steps: [{ instruction: 'Cook.' }],
    });
}

async function lineIds(recipeId: string): Promise<string[]> {
    const { rows } = await pool.query<{ food_lookup_id: string }>(
        `SELECT food_lookup_id FROM ingredients WHERE recipe_id = $1 ORDER BY sort_order`,
        [recipeId],
    );

    return rows.map((row) => row.food_lookup_id);
}

async function lookupExists(id: string): Promise<boolean> {
    const { rows } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM food_lookups WHERE id = $1`, [id]);

    return (rows[0]?.n ?? 0) > 0;
}

describe.skipIf(!hasDatabaseUrl)('the life of a line binding (e2e, assembled app + food fake)', () => {
    beforeAll(async () => {
        food = await startFoodFake();
        food.foods.set(`${SCOPE}-flour`, { name: 'Plain flour', status: 'RESOLVED' });
        process.env['FOOD_SERVICE_URL'] = food.origin;

        booted = await bootRecipeApp({ databaseUrl: roleDb.appUrl, devAuthUserId: COOK_A });
        pool = new pg.Pool({ connectionString: roleDb.appUrl, max: 3 });
    });

    afterAll(async () => {
        if (pool !== undefined) {
            await pool.query(`DELETE FROM recipes WHERE owner_id = ANY($1)`, [[COOK_A, COOK_B]]);
            await deleteBindingsMatching(pool, `${SCOPE}%`);
            await pool.end();
        }

        await booted?.close();
        await food?.close();
    });

    it('gives two cooks picking one food at once ONE binding (AE19)', async () => {
        // Sequential dev-auth identities cannot race over HTTP, so both picks run as one cook — the convergence is a
        // property of the food, not of who picked it (the repository e2e races two transactions directly).
        const [first, second] = await Promise.all([
            idOf(json(COOK_A, 'POST', '/api/v1/ingredients/by-food', 200, { foodId: `${SCOPE}-flour` })),
            idOf(json(COOK_A, 'POST', '/api/v1/ingredients/by-food', 200, { foodId: `${SCOPE}-flour` })),
        ]);

        expect(first).toBe(second);
    });

    it('converges two cooks’ unmatched name on ONE failure, but never two declared names', async () => {
        const failureA = await idOf(
            json(COOK_A, 'POST', '/api/v1/ingredients/by-name', 202, { name: `${SCOPE} gubbins` }),
        );
        const failureB = await idOf(
            json(COOK_B, 'POST', '/api/v1/ingredients/by-name', 202, { name: `${SCOPE} gubbins` }),
        );
        const declaredA = await idOf(json(COOK_A, 'POST', '/api/v1/ingredients', 201, { name: `${SCOPE} house mix` }));
        const declaredB = await idOf(json(COOK_B, 'POST', '/api/v1/ingredients', 201, { name: `${SCOPE} house mix` }));

        expect(failureB).toBe(failureA);
        expect(declaredB).not.toBe(declaredA);
    });

    it('settles a failure waiting on its source for EVERY line on it, and deletes nothing (R13)', async () => {
        food.foods.set(`${SCOPE}-za-atar`, { name: 'Za’atar', status: 'PENDING' });
        food.names.set(`${SCOPE} za'atar`, `${SCOPE}-za-atar`);

        const failure = await idOf(
            json(COOK_A, 'POST', '/api/v1/ingredients/by-name', 202, { name: `${SCOPE} za'atar` }),
        );
        const recipeA = await recipeOn(COOK_A, 'za’atar A', [failure]);
        const recipeB = await recipeOn(COOK_B, 'za’atar B', [failure]);

        food.foods.set(`${SCOPE}-za-atar`, { name: 'Za’atar', status: 'RESOLVED' });

        const settled = await json<{ id: string; foodId?: string }>(
            COOK_A,
            'GET',
            `/api/v1/ingredients/${failure}/status`,
            200,
        );

        expect(settled.foodId).toBe(`${SCOPE}-za-atar`);
        expect(settled.id).not.toBe(failure);
        expect(await lineIds(recipeA.id)).toStrictEqual([settled.id]);
        expect(await lineIds(recipeB.id)).toStrictEqual([settled.id]);
        expect(await lookupExists(failure)).toBe(true);
    });

    it('⛔ a save built before a settle keeps the settled line where the settle put it, and is not an ingredient edit', async () => {
        food.foods.set(`${SCOPE}-sumac`, { name: 'Sumac', status: 'PENDING' });
        food.names.set(`${SCOPE} sumac`, `${SCOPE}-sumac`);

        const failure = await idOf(
            json(COOK_A, 'POST', '/api/v1/ingredients/by-name', 202, { name: `${SCOPE} sumac` }),
        );
        const recipe = await recipeOn(COOK_A, 'sumac', [failure]);

        food.foods.set(`${SCOPE}-sumac`, { name: 'Sumac', status: 'RESOLVED' });

        const settled = await json<{ id: string }>(COOK_A, 'GET', `/api/v1/ingredients/${failure}/status`, 200);

        // The cook's editor still holds the pre-settle read: same line, same failure id, a new title.
        await json(COOK_A, 'PATCH', `/api/v1/recipes/${recipe.id}`, 200, {
            expectedVersion: recipe.currentVersion,
            title: `${SCOPE} sumac renamed`,
            ingredients: [{ ingredientId: failure, quantity: { kind: 'exact', value: 1 }, unit: 'cup' }],
            steps: [{ instruction: 'Cook.' }],
        });

        const { rows } = await pool.query<{ has_substantive_edit: boolean }>(
            `SELECT has_substantive_edit FROM recipes WHERE id = $1`,
            [recipe.id],
        );

        expect(await lineIds(recipe.id)).toStrictEqual([settled.id]);
        expect(rows[0]?.has_substantive_edit).toBe(false);
    });

    it('⛔ a settle is final: later polls and adds answer with its target, and nothing rewrites the record', async () => {
        food.foods.set(`${SCOPE}-cardamom`, { name: 'Cardamom', status: 'PENDING' });
        food.names.set(`${SCOPE} cardamom`, `${SCOPE}-cardamom`);

        const failure = await idOf(
            json(COOK_A, 'POST', '/api/v1/ingredients/by-name', 202, { name: `${SCOPE} cardamom` }),
        );

        await recipeOn(COOK_A, 'cardamom', [failure]);
        food.foods.set(`${SCOPE}-cardamom`, { name: 'Cardamom', status: 'RESOLVED' });

        const target = (await json<{ id: string }>(COOK_A, 'GET', `/api/v1/ingredients/${failure}/status`, 200)).id;
        const record = async () =>
            (
                await pool.query<{ settled: string | null; reason: string; attempts: number }>(
                    `SELECT u.settled_lookup_id AS settled, u.reason_code AS reason, u.attempts
                       FROM food_lookups l JOIN unresolved_foods u ON u.id = l.unresolved_food_id
                      WHERE l.id = $1`,
                    [failure],
                )
            ).rows[0];
        const settledRecord = await record();

        // Food now answers the phrase with another food: a new add binds that one, and the record keeps its target.
        food.foods.set(`${SCOPE}-cardamom-green`, { name: 'Green cardamom', status: 'RESOLVED' });
        food.names.set(`${SCOPE} cardamom`, `${SCOPE}-cardamom-green`);
        await json(COOK_B, 'POST', '/api/v1/ingredients/by-name', 202, { name: `${SCOPE} cardamom` });

        // A poll of the old failure answers the settle's target, not food's current answer.
        expect((await json<{ id: string }>(COOK_B, 'GET', `/api/v1/ingredients/${failure}/status`, 200)).id).toBe(
            target,
        );

        // With food down, an add of the phrase cannot name the target: it is answered with the failure as it stands
        // (its line forwards at save), and it writes no attempt.
        food.down = true;

        try {
            expect(
                (
                    await json<{ id: string }>(COOK_B, 'POST', '/api/v1/ingredients/by-name', 202, {
                        name: `${SCOPE} cardamom`,
                    })
                ).id,
            ).toBe(failure);
        } finally {
            food.down = false;
        }

        expect(settledRecord?.settled).toBe(target);
        expect(await record()).toStrictEqual(settledRecord);
    });

    it('⛔ moves only the rebinding cook’s line — the other cook’s line on the same failure is untouched (AE7)', async () => {
        const phrase = `${SCOPE} thingummy`;
        food.foods.set(`${SCOPE}-a-own`, { name: 'A’s thingummy', status: 'RESOLVED', ownerId: COOK_A });

        const failure = await idOf(json(COOK_A, 'POST', '/api/v1/ingredients/by-name', 202, { name: phrase }));
        const recipeA = await recipeOn(COOK_A, 'thingummy A', [failure]);
        const recipeB = await recipeOn(COOK_B, 'thingummy B', [failure]);

        await json(COOK_A, 'POST', `/api/v1/recipes/${recipeA.id}/ingredients/0/rebind`, 200, {
            expectedVersion: recipeA.currentVersion,
            target: { kind: 'catalogFood', foodId: `${SCOPE}-a-own` },
        });

        expect(await lineIds(recipeB.id)).toStrictEqual([failure]);
        expect(await lookupExists(failure)).toBe(true);
    });

    it('keeps a shared binding when one recipe drops its line (AE8)', async () => {
        const flour = await idOf(
            json(COOK_A, 'POST', '/api/v1/ingredients/by-food', 200, { foodId: `${SCOPE}-flour` }),
        );
        const other = await idOf(json(COOK_A, 'POST', '/api/v1/ingredients', 201, { name: `${SCOPE} water` }));
        const keeper = await recipeOn(COOK_B, 'flour keeper', [flour]);
        const dropper = await recipeOn(COOK_A, 'flour dropper', [flour, other]);

        await json(COOK_A, 'PATCH', `/api/v1/recipes/${dropper.id}`, 200, {
            expectedVersion: dropper.currentVersion,
            ingredients: [{ ingredientId: other, quantity: { kind: 'exact', value: 1 }, unit: 'cup' }],
        });

        expect(await lookupExists(flour)).toBe(true);
        expect((await json<RecipeBody>(COOK_B, 'GET', `/api/v1/recipes/${keeper.id}`, 200)).ingredients[0]?.name).toBe(
            'Plain flour',
        );
    });

    it('refuses a save naming a binding that no longer exists with a 400, never a 500', async () => {
        const gone = await idOf(json(COOK_A, 'POST', '/api/v1/ingredients', 201, { name: `${SCOPE} vanished` }));

        await pool.query(
            `WITH lookup AS (DELETE FROM food_lookups WHERE id = $1 RETURNING unresolved_food_id)
             DELETE FROM unresolved_foods WHERE id IN (SELECT unresolved_food_id FROM lookup)`,
            [gone],
        );

        const response = await call(COOK_A, 'POST', '/api/v1/recipes', {
            title: `${SCOPE} vanished`,
            servings: 2,
            prepTimeMinutes: 5,
            cookTimeMinutes: 10,
            totalTimeMinutes: 15,
            ingredients: [{ ingredientId: gone, quantity: { kind: 'exact', value: 1 } }],
            steps: [{ instruction: 'Cook.' }],
        });

        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ code: 'UNKNOWN_INGREDIENT' });
    });
});
