/**
 * The publish gate against a REAL database (LOCAL e2e, `docs/CODING_STANDARDS.md` §7.1a; owner rulings 2026-10-13: a
 * cuisine is required to publish, the public-domain import exempt).
 *
 * What the mocked tier cannot prove and these cases do:
 *
 * - that the canonical cuisine the wire parse produced is what the `recipes.cuisine` column holds;
 * - that a PATCH's `null` really clears the column of a draft, and that the same PATCH on a published recipe is refused
 *   with the column left as it was;
 * - that a refused publish leaves the row's status and version untouched.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { bootRecipeApp, type BootedRecipeApp } from './harness.js';
import { asPrincipal } from '../support/asPrincipal.js';
import { bearerFor, startFoodFake, type FoodFake } from '../support/foodFake.js';
import { deleteBindingsMatching } from '../support/bindingCleanup.js';
import { recipeDb } from '../support/roleDb.js';

const roleDb = recipeDb();

const SCOPE = 'e2e-publish-gate';
const COOK = '01JPUBLISHGATEE2E00000COOK';
const BASIL = `${SCOPE}-basil`;

interface RecipeBody {
    readonly id: string;
    readonly status: string;
    readonly currentVersion: number;
    readonly cuisine?: string;
}

let booted: BootedRecipeApp;
let pool: pg.Pool;
let food: FoodFake;
let basilLookup: string;

async function call(method: string, path: string, body?: unknown): Promise<Response> {
    return asPrincipal(COOK, () =>
        fetch(`${booted.baseUrl}${path}`, {
            method,
            headers: { authorization: bearerFor(COOK), 'content-type': 'application/json' },
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

/** A body with one line and one step. */
function recipeBody(fields: Record<string, unknown>): Record<string, unknown> {
    return {
        title: `${SCOPE} pesto`,
        servings: 2,
        prepTimeMinutes: 5,
        cookTimeMinutes: 0,
        totalTimeMinutes: 5,
        ingredients: [{ ingredientId: basilLookup, quantity: { kind: 'exact', value: 1 }, unit: 'cup' }],
        steps: [{ instruction: 'Blend.' }],
        ...fields,
    };
}

async function storedRow(id: string): Promise<{ cuisine: string | null; status: string; current_version: number }> {
    const { rows } = await pool.query<{ cuisine: string | null; status: string; current_version: number }>(
        'SELECT cuisine, status, current_version FROM recipes WHERE id = $1',
        [id],
    );
    const [row] = rows;

    if (row === undefined) {
        throw new Error(`recipe ${id} has no row`);
    }

    return row;
}

beforeAll(async () => {
    food = await startFoodFake();
    food.foods.set(BASIL, { name: 'Basil', status: 'RESOLVED' });
    process.env['FOOD_SERVICE_URL'] = food.origin;

    booted = await bootRecipeApp({ databaseUrl: roleDb.appUrl, devAuthUserId: COOK });
    pool = new pg.Pool({ connectionString: roleDb.appUrl, max: 3 });
    basilLookup = (await json<{ id: string }>('POST', '/api/v1/ingredients/by-food', 200, { foodId: BASIL })).id;
});

afterAll(async () => {
    if (pool !== undefined) {
        await pool.query('DELETE FROM recipes WHERE owner_id = $1', [COOK]);
        await deleteBindingsMatching(pool, `${SCOPE}%`);
        await pool.end();
    }

    await booted?.close();
    await food?.close();
});

describe('a cuisine is required to publish (e2e)', () => {
    it('stores the canonical cuisine in the column', async () => {
        const created = await json<RecipeBody>('POST', '/api/v1/recipes', 201, recipeBody({ cuisine: ' szechuan ' }));

        expect(created.cuisine).toBe('Sichuan');
        expect((await storedRow(created.id)).cuisine).toBe('Sichuan');
    });

    it('refuses a published create with no cuisine, and writes no row', async () => {
        const before = await pool.query('SELECT count(*)::int AS n FROM recipes WHERE owner_id = $1', [COOK]);
        const response = await call('POST', '/api/v1/recipes', recipeBody({}));
        const body = (await response.json()) as { code?: string; details?: { missing?: string[] } };
        const after = await pool.query('SELECT count(*)::int AS n FROM recipes WHERE owner_id = $1', [COOK]);

        expect(response.status).toBe(400);
        expect(body).toMatchObject({ code: 'PUBLISH_REQUIREMENTS_UNMET', details: { missing: ['cuisine'] } });
        expect(after.rows[0]).toEqual(before.rows[0]);
    });

    it('clears the cuisine of a draft with `null`', async () => {
        const draft = await json<RecipeBody>(
            'POST',
            '/api/v1/recipes',
            201,
            recipeBody({ status: 'draft', cuisine: 'Thai' }),
        );

        await json<RecipeBody>('PATCH', `/api/v1/recipes/${draft.id}`, 200, {
            expectedVersion: draft.currentVersion,
            cuisine: null,
        });

        expect((await storedRow(draft.id)).cuisine).toBeNull();
    });

    it('refuses clearing the cuisine of a published recipe, leaving the row as it was', async () => {
        const published = await json<RecipeBody>('POST', '/api/v1/recipes', 201, recipeBody({ cuisine: 'Thai' }));
        const before = await storedRow(published.id);

        const response = await call('PATCH', `/api/v1/recipes/${published.id}`, {
            expectedVersion: published.currentVersion,
            cuisine: null,
        });

        expect(response.status).toBe(400);
        expect(await storedRow(published.id)).toEqual(before);
    });

    it('refuses publishing a draft that has no cuisine, and publishes it once the PATCH supplies one', async () => {
        const draft = await json<RecipeBody>('POST', '/api/v1/recipes', 201, recipeBody({ status: 'draft' }));

        const refused = await call('PATCH', `/api/v1/recipes/${draft.id}`, {
            expectedVersion: draft.currentVersion,
            status: 'published',
        });
        expect(refused.status).toBe(400);
        expect(await storedRow(draft.id)).toMatchObject({ status: 'draft', current_version: draft.currentVersion });

        const published = await json<RecipeBody>('PATCH', `/api/v1/recipes/${draft.id}`, 200, {
            expectedVersion: draft.currentVersion,
            status: 'published',
            cuisine: 'nyonya',
        });

        expect(published.status).toBe('published');
        expect((await storedRow(draft.id)).cuisine).toBe('Nyonya');
    });
});
