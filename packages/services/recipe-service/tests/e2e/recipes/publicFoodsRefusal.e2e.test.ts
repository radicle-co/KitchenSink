/**
 * A private food lives only in a private recipe (ADR-0029 section 4; owner rulings 2026-11-08), through the fully
 * assembled app, a real Postgres and a food-service fake (LOCAL e2e, `docs/CODING_STANDARDS.md` section 7.1a).
 *
 * What a mocked tier cannot prove and these cases do: that the refusal is a real `400 PRIVATE_FOODS_ON_PUBLIC_RECIPE`
 * naming the line, that nothing was written, that a food promoted since it was bound is recaptured (the stale captured
 * owner is cleared in the write's own transaction), that the cook's own list says which recipes hold a private food, and
 * that the detail read states each line's food visibility from food's live answer.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { bootRecipeApp, type BootedRecipeApp } from '../harness.js';
import { asPrincipal } from '../../support/asPrincipal.js';
import { bearerFor, startFoodFake, type FoodFake } from '../../support/foodFake.js';
import { deleteBindingsMatching } from '../../support/bindingCleanup.js';
import { recipeDb } from '../../support/roleDb.js';

const roleDb = recipeDb();

const SCOPE = 'e2e-public-foods-refusal';
const AUTHOR = '01JPUBFOODSREFUSAL000AUTHOR';
const PRIVATE_FOOD = `${SCOPE}-private`;
const SHARED_FOOD = `${SCOPE}-shared`;

interface LineBody {
    readonly ingredientId: string;
    readonly foodId?: string;
    readonly foodVisibility?: string;
}

interface RecipeBody {
    readonly id: string;
    readonly visibility: string;
    readonly currentVersion: number;
    readonly ingredients: readonly LineBody[];
    readonly holdsPrivateFood?: boolean;
}

interface RefusalBody {
    readonly code: string;
    readonly details: { readonly lines: readonly { readonly sortOrder: number; readonly foodId: string }[] };
}

let booted: BootedRecipeApp;
let pool: pg.Pool;
let food: FoodFake;
let privateLookup: string;
let sharedLookup: string;

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

const recipeBody = (title: string, lookupIds: readonly string[], visibility: 'public' | 'private') => ({
    title: `${SCOPE} ${title}`,
    visibility,
    servings: 2,
    prepTimeMinutes: 5,
    cookTimeMinutes: 10,
    totalTimeMinutes: 15,
    cuisine: 'Italian',
    ingredients: lookupIds.map((ingredientId) => ({
        ingredientId,
        quantity: { kind: 'exact', value: 1 },
        unit: 'cup',
    })),
    steps: [{ instruction: 'Cook.' }],
});

async function ownerOf(lookupId: string): Promise<string | null> {
    const { rows } = await pool.query<{ food_owner_id: string | null }>(
        `SELECT food_owner_id FROM food_lookups WHERE id = $1`,
        [lookupId],
    );

    return rows[0]?.food_owner_id ?? null;
}

describe('a public recipe holds no private food (e2e, assembled app + food fake)', () => {
    beforeAll(async () => {
        food = await startFoodFake();
        food.foods.set(SHARED_FOOD, { name: 'Flour', status: 'RESOLVED' });
        food.foods.set(PRIVATE_FOOD, { name: 'Grandma’s rub', status: 'RESOLVED', ownerId: AUTHOR });
        process.env['FOOD_SERVICE_URL'] = food.origin;

        booted = await bootRecipeApp({ databaseUrl: roleDb.appUrl, devAuthUserId: AUTHOR });
        pool = new pg.Pool({ connectionString: roleDb.appUrl, max: 3 });
        sharedLookup = (await json<{ id: string }>('POST', '/api/v1/ingredients/by-food', 200, { foodId: SHARED_FOOD }))
            .id;
        privateLookup = (
            await json<{ id: string }>('POST', '/api/v1/ingredients/by-food', 200, { foodId: PRIVATE_FOOD })
        ).id;
    });

    afterAll(async () => {
        await pool.query(`DELETE FROM recipes WHERE owner_id = $1`, [AUTHOR]);
        await deleteBindingsMatching(pool, `${SCOPE}%`);
        await pool.end();
        await booted.close();
        await food.close();
        delete process.env['FOOD_SERVICE_URL'];
    });

    it('refuses a public create with 400, naming the line and its food, and writes nothing', async () => {
        const response = await call(
            'POST',
            '/api/v1/recipes',
            recipeBody('refused create', [sharedLookup, privateLookup], 'public'),
        );
        const body = (await response.json()) as RefusalBody;
        const { rows } = await pool.query(`SELECT 1 FROM recipes WHERE title = $1`, [`${SCOPE} refused create`]);

        expect(response.status).toBe(400);
        expect(body.code).toBe('PRIVATE_FOODS_ON_PUBLIC_RECIPE');
        expect(body.details.lines).toEqual([{ sortOrder: 1, foodId: PRIVATE_FOOD }]);
        expect(rows).toHaveLength(0);
    });

    it('accepts the same lines in a private recipe, which the cook’s list then marks as holding a private food', async () => {
        const created = await json<RecipeBody>(
            'POST',
            '/api/v1/recipes',
            201,
            recipeBody('private holder', [sharedLookup, privateLookup], 'private'),
        );
        const plain = await json<RecipeBody>(
            'POST',
            '/api/v1/recipes',
            201,
            recipeBody('private plain', [sharedLookup], 'private'),
        );
        const list = await json<{ data: RecipeBody[] }>('GET', '/api/v1/recipes?pageSize=50', 200);

        expect(list.data.find((recipe) => recipe.id === created.id)?.holdsPrivateFood).toBe(true);
        expect(list.data.find((recipe) => recipe.id === plain.id)?.holdsPrivateFood).toBe(false);
    });

    it('states each line’s food visibility from food’s live answer on the detail read', async () => {
        const created = await json<RecipeBody>(
            'POST',
            '/api/v1/recipes',
            201,
            recipeBody('visibility lines', [sharedLookup, privateLookup], 'private'),
        );
        const detail = await json<RecipeBody>('GET', `/api/v1/recipes/${created.id}`, 200);

        expect(detail.ingredients.find((line) => line.ingredientId === sharedLookup)?.foodVisibility).toBe('public');
        expect(detail.ingredients.find((line) => line.ingredientId === privateLookup)?.foodVisibility).toBe('private');
    });

    it('refuses making a private recipe that holds a private food public, and it stays private', async () => {
        const created = await json<RecipeBody>(
            'POST',
            '/api/v1/recipes',
            201,
            recipeBody('stays private', [privateLookup], 'private'),
        );
        const response = await call('PATCH', `/api/v1/recipes/${created.id}/visibility`, { visibility: 'public' });

        expect(response.status).toBe(400);
        expect(((await response.json()) as RefusalBody).code).toBe('PRIVATE_FOODS_ON_PUBLIC_RECIPE');
        expect((await json<RecipeBody>('GET', `/api/v1/recipes/${created.id}`, 200)).visibility).toBe('private');
    });

    it('refuses publishing a draft that holds a private food, and a patch that puts one on a public recipe', async () => {
        const draft = await json<RecipeBody>('POST', '/api/v1/recipes', 201, {
            ...recipeBody('draft holder', [privateLookup], 'public'),
            status: 'draft',
        });
        const publish = await call('PATCH', `/api/v1/recipes/${draft.id}`, {
            expectedVersion: draft.currentVersion,
            status: 'published',
        });

        expect(publish.status).toBe(400);
        expect(((await publish.json()) as RefusalBody).code).toBe('PRIVATE_FOODS_ON_PUBLIC_RECIPE');

        const open = await json<RecipeBody>(
            'POST',
            '/api/v1/recipes',
            201,
            recipeBody('open', [sharedLookup], 'public'),
        );
        const put = await call('PATCH', `/api/v1/recipes/${open.id}`, {
            expectedVersion: open.currentVersion,
            ingredients: [{ ingredientId: privateLookup, quantity: { kind: 'exact', value: 1 }, unit: 'cup' }],
        });

        expect(put.status).toBe(400);
        expect(((await put.json()) as RefusalBody).details.lines).toEqual([{ sortOrder: 0, foodId: PRIVATE_FOOD }]);
    });

    it('refuses publishing a draft whose private line was renamed and saved first, and the line keeps the private food', async () => {
        // The editor's two writes, as `toUpdateRecipeInput` builds them: the row editor's Name is the line's
        // `displayText`, so renaming a line and closing the row editor (a save) sends the SAME binding with the cook's
        // words; the later Publish sends the lines again with `status`.
        const editedLine = {
            ingredientId: privateLookup,
            quantity: { kind: 'absent' },
            displayText: 'pie crust',
            note: '9 inch',
            preparation: 'unbaked',
        };
        const draft = await json<RecipeBody>('POST', '/api/v1/recipes', 201, {
            ...recipeBody('renamed then published', [privateLookup], 'public'),
            status: 'draft',
        });
        const saved = await json<RecipeBody>('PATCH', `/api/v1/recipes/${draft.id}`, 200, {
            expectedVersion: draft.currentVersion,
            ingredients: [editedLine],
        });
        const { rows: bound } = await pool.query<{ food_lookup_id: string; food_owner_id: string | null }>(
            `SELECT i.food_lookup_id, l.food_owner_id
               FROM ingredients i JOIN food_lookups l ON l.id = i.food_lookup_id
              WHERE i.recipe_id = $1`,
            [draft.id],
        );

        expect(bound).toEqual([{ food_lookup_id: privateLookup, food_owner_id: AUTHOR }]);

        const publish = await call('PATCH', `/api/v1/recipes/${draft.id}`, {
            expectedVersion: saved.currentVersion,
            status: 'published',
            ingredients: [editedLine],
        });
        const { rows: stored } = await pool.query<{ status: string; visibility: string }>(
            `SELECT status, visibility FROM recipes WHERE id = $1`,
            [draft.id],
        );

        expect(publish.status).toBe(400);
        expect(((await publish.json()) as RefusalBody).details.lines).toEqual([{ sortOrder: 0, foodId: PRIVATE_FOOD }]);
        expect(stored).toEqual([{ status: 'draft', visibility: 'public' }]);
    });

    it('a PATCH that swaps the private line for a public food AND publishes in one request succeeds', async () => {
        // The draft holds the private food; the same PATCH replaces it and publishes. The recipe row is written before
        // its lines, so a trigger that judged the recipe against the OLD lines would answer a raw 500.
        const draft = await json<RecipeBody>('POST', '/api/v1/recipes', 201, {
            ...recipeBody('swap and publish', [privateLookup], 'public'),
            status: 'draft',
        });
        const published = await json<RecipeBody & { readonly status: string }>(
            'PATCH',
            `/api/v1/recipes/${draft.id}`,
            200,
            {
                expectedVersion: draft.currentVersion,
                status: 'published',
                ingredients: [{ ingredientId: sharedLookup, quantity: { kind: 'exact', value: 1 }, unit: 'cup' }],
            },
        );

        expect(published.status).toBe('published');
        expect(published.ingredients.map((line) => line.ingredientId)).toEqual([sharedLookup]);
    });

    it('never answers 5xx when set-visibility races an update that puts a private food on the same recipe', async () => {
        const outcomes: number[] = [];

        for (let round = 0; round < 12; round += 1) {
            const created = await json<RecipeBody>(
                'POST',
                '/api/v1/recipes',
                201,
                recipeBody(`race ${round}`, [sharedLookup], 'private'),
            );
            const [patch, visibility] = await Promise.all([
                call('PATCH', `/api/v1/recipes/${created.id}`, {
                    expectedVersion: created.currentVersion,
                    ingredients: [{ ingredientId: privateLookup, quantity: { kind: 'exact', value: 1 }, unit: 'cup' }],
                }),
                call('PATCH', `/api/v1/recipes/${created.id}/visibility`, { visibility: 'public' }),
            ]);

            outcomes.push(patch.status, visibility.status);

            const { rows } = await pool.query(
                `SELECT 1 FROM recipes r WHERE r.id = $1 AND r.visibility = 'public' AND r.status = 'published'
                    AND recipe_holds_private_food(r.id)`,
                [created.id],
            );

            expect(rows).toHaveLength(0);
        }

        expect(outcomes.filter((status) => status >= 500)).toEqual([]);
    });

    it('RECAPTURES a food promoted since it was bound: the write succeeds and clears the stale captured owner', async () => {
        // The food is private when the cook binds it, and promoted by staff afterwards.
        food.foods.set(`${SCOPE}-promoted`, { name: 'Promoted blend', status: 'RESOLVED', ownerId: AUTHOR });
        const lookup = (
            await json<{ id: string }>('POST', '/api/v1/ingredients/by-food', 200, { foodId: `${SCOPE}-promoted` })
        ).id;

        expect(await ownerOf(lookup)).toBe(AUTHOR);

        food.foods.set(`${SCOPE}-promoted`, { name: 'Promoted blend', status: 'RESOLVED' });

        const created = await json<RecipeBody>(
            'POST',
            '/api/v1/recipes',
            201,
            recipeBody('recaptured', [lookup], 'public'),
        );

        expect(created.visibility).toBe('public');
        expect(await ownerOf(lookup)).toBeNull();
    });

    it('FAILS CLOSED when food is down: the captured owner stands and the public write is refused', async () => {
        food.down = true;

        try {
            const response = await call('POST', '/api/v1/recipes', recipeBody('food down', [privateLookup], 'public'));

            expect(response.status).toBe(400);
            expect(((await response.json()) as RefusalBody).code).toBe('PRIVATE_FOODS_ON_PUBLIC_RECIPE');
        } finally {
            food.down = false;
        }
    });

    it('leaves, after every case above, no published public recipe holding a line whose food is private', async () => {
        const { rows } = await pool.query(
            `SELECT r.id FROM recipes r
               JOIN ingredients i ON i.recipe_id = r.id
               JOIN food_lookups l ON l.id = i.food_lookup_id
              WHERE r.owner_id = $1 AND r.status = 'published' AND r.visibility = 'public'
                AND l.food_id::text = ANY($2::text[])`,
            [AUTHOR, [PRIVATE_FOOD]],
        );

        expect(rows).toEqual([]);
    });
});
