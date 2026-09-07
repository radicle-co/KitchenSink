/**
 * `POST /api/v1/recipes/nutrition-batch` end to end — real booted app, real Postgres, a real HTTP round
 * trip to a stubbed food origin.
 *
 * Four properties live only at this tier. A unit test mocks the boundary, so it proves the code calls its
 * mock correctly and nothing more:
 *
 *  1. **⛔ 20 recipes cost EXACTLY ONE food call.** This is the assertion the whole batching design exists
 *     for, and it is only observable where the food origin is a real socket counting real requests. A
 *     per-recipe lookup returns identical, correct answers — it is silently 20× the fan-out against a
 *     service the recipe read now depends on at runtime.
 *  2. **⛔ Authorization is the SQL, and absence is the answer.** Another owner's private recipe, another
 *     owner's public DRAFT (the W8-a.3 term a visibility-only predicate would leak) and a tombstoned
 *     recipe must all be missing from the map. Only a real database can prove the predicate compiled into
 *     the query the endpoint actually runs.
 *  3. **The id cap answers a `400` a client can PARSE**, carrying `details.fields` — the shape the
 *     published `VALIDATION_FAILED` arm promises. A cap enforced with a hand-thrown message would still be
 *     a 400 and would still be unreadable by the service's own published schema.
 *  4. **A recipe with NO ingredient lines is PRESENT**, reported `no_resolved_ingredients`. An inner join
 *     would drop it, and a dropped recipe reads as "not yours" — a data fact silently rendered as an
 *     authorization one.
 *
 * The food origin is stubbed at the HTTP boundary rather than mocked in-process, exactly as
 * `nutrition.integration.test.ts` does it: the request URL is part of food's contract (ADR-0020 keys its
 * CDN cache on it), and an in-process mock would let that drift silently.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import pg from 'pg';

import { bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from '../../../tests/e2e/harness.js';
import { createRecipeDrizzle, type RecipeDrizzle } from '../../../src/database/client.js';
import { ingredients, recipeIngredients, recipes } from '../../../src/database/schema/index.js';
import { MAX_NUTRITION_RECIPE_IDS } from '../../../src/recipes/recipes.schema.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];

const OWNER = '01JBATCHNUTRITIONOWNER001';
const OTHER_OWNER = '01JBATCHNUTRITIONOTHER001';
const FLOUR_CATALOG_ID = '00000000-0000-4000-8000-00000000b100';
const FLOUR_FOOD_ID = '01JFOODBATCHFLOUR000000001';
/** A catalog ingredient with NO food id — nothing maps to a food, so nothing can be accounted for. */
const FREEFORM_CATALOG_ID = '00000000-0000-4000-8000-00000000b200';

/** A deterministic uuid per index, so a 20-recipe batch is easy to build and to assert over. */
function recipeId(index: number): string {
    return `00000000-0000-4000-8000-${`${index}`.padStart(12, '0')}`;
}

/** Every request path the recipe service sent to the food origin, in order. */
const foodRequests: string[] = [];

/** A stub standing in for food's `GET /api/v1/foods/nutrition`, counting every request it receives. */
async function startFoodStub(): Promise<{ server: Server; origin: string }> {
    const server = createServer((req, res) => {
        const url = req.url ?? '';

        foodRequests.push(url);

        if (url.startsWith('/api/v1/foods/nutrition')) {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(
                JSON.stringify({
                    foods: [
                        {
                            id: FLOUR_FOOD_ID,
                            status: 'RESOLVED',
                            caloriesPer100g: 350,
                            proteinGPer100g: 12,
                            carbsGPer100g: 70,
                            fatGPer100g: 2,
                            portions: [{ unit: 'cup', gramsPerUnit: 125 }],
                        },
                    ],
                    unknownIds: [],
                }),
            );

            return;
        }

        res.writeHead(404).end();
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

    return { server, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

/** One recipe's known-state body, as the wire carries it. */
interface KnownState {
    state: 'known';
    caloriesPerServing: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    isComplete: boolean;
    freshness: 'fresh' | 'stale';
}

/** The response body: recipe id → state. A recipe the caller may not read has NO key. */
interface NutritionBody {
    nutrition: Record<string, KnownState | { state: 'unaccounted'; reason: string }>;
}

describe.skipIf(!hasDatabaseUrl)('POST /api/v1/recipes/nutrition-batch (integration)', () => {
    let booted: BootedRecipeApp;
    let baseUrl: string;
    let pool: pg.Pool;
    let db: RecipeDrizzle;
    let foodStub: Server;

    /** Insert a recipe owned by `ownerId` with `lineCount` flour lines of 200 g each. */
    async function seedRecipe(options: {
        id: string;
        ownerId?: string;
        visibility?: string;
        status?: string;
        deleted?: boolean;
        ingredientId?: string | null;
    }): Promise<void> {
        await db
            .insert(recipes)
            .values({
                id: options.id,
                ownerId: options.ownerId ?? OWNER,
                title: `Batch recipe ${options.id}`,
                visibility: options.visibility ?? 'public',
                status: options.status ?? 'published',
                servings: 2,
                prepTimeMinutes: 5,
                cookTimeMinutes: 10,
                totalTimeMinutes: 15,
                tags: [],
                dietaryFlags: [],
                ingredientNamesText: '',
                ...(options.deleted === true ? { deletedAt: new Date() } : {}),
            })
            .onConflictDoNothing();

        if (options.ingredientId === null) {
            return;
        }

        await db
            .insert(recipeIngredients)
            .values({
                recipeId: options.id,
                ingredientId: options.ingredientId ?? FLOUR_CATALOG_ID,
                ingredientName: 'Batch Flour',
                quantity: '200',
                unit: 'g',
                sortOrder: 0,
                isUserEntered: false,
            })
            .onConflictDoNothing();
    }

    /** Ask the endpoint for `ids` as the dev-auth owner. */
    async function askFor(ids: readonly string[]): Promise<Response> {
        return fetch(`${baseUrl}/api/v1/recipes/nutrition-batch`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: 'Bearer integration-caller-token' },
            body: JSON.stringify({ recipeIds: ids }),
        });
    }

    beforeAll(async () => {
        const stub = await startFoodStub();
        foodStub = stub.server;
        process.env['FOOD_SERVICE_URL'] = stub.origin;

        booted = await bootRecipeApp({ devAuthUserId: OWNER });
        baseUrl = booted.baseUrl;
        pool = new pg.Pool({ connectionString: DATABASE_URL });
        db = createRecipeDrizzle(pool);

        await db
            .insert(ingredients)
            .values([
                { id: FLOUR_CATALOG_ID, name: 'Batch Flour', foodId: FLOUR_FOOD_ID, foodResolutionStatus: 'RESOLVED' },
                { id: FREEFORM_CATALOG_ID, name: 'Batch Freeform', isUserEntered: true },
            ])
            .onConflictDoNothing();
    });

    afterAll(async () => {
        await pool.end();
        await booted.close();
        await new Promise<void>((resolve) => foodStub.close(() => resolve()));
    });

    it('⛔ answers 20 recipes with EXACTLY ONE food call', async () => {
        const ids = Array.from({ length: 20 }, (_value, index) => recipeId(index + 1));

        for (const id of ids) {
            await seedRecipe({ id });
        }

        foodRequests.length = 0;
        const response = await askFor(ids);

        expect(response.status).toBe(200);
        const body = (await response.json()) as NutritionBody;

        expect(Object.keys(body.nutrition)).toHaveLength(20);
        // ⛔ THE assertion. One request, and its id list is the DEDUPLICATED set (all 20 recipes share the
        // same food), which is also what makes food's URL-keyed cache entry shared rather than per-recipe.
        expect(foodRequests.filter((url) => url.startsWith('/api/v1/foods/nutrition'))).toStrictEqual([
            `/api/v1/foods/nutrition?ids=${FLOUR_FOOD_ID}`,
        ]);
    });

    it('computes each recipe’s per-serving figure from food’s live response', async () => {
        // 200 g at 350 kcal/100 g = 700 kcal; ÷ 2 servings → 350.
        const id = recipeId(1);
        const body = (await (await askFor([id])).json()) as NutritionBody;

        expect(body.nutrition[id]).toStrictEqual({
            state: 'known',
            caloriesPerServing: 350,
            proteinG: 12,
            carbsG: 70,
            fatG: 2,
            isComplete: true,
            freshness: 'fresh',
        });
    });

    it('⛔ OMITS another owner’s PRIVATE recipe rather than reporting on it', async () => {
        const mine = recipeId(1);
        const theirs = recipeId(900);
        await seedRecipe({ id: theirs, ownerId: OTHER_OWNER, visibility: 'private' });

        const body = (await (await askFor([mine, theirs])).json()) as NutritionBody;

        expect(Object.keys(body.nutrition)).toStrictEqual([mine]);
    });

    it('⛔ OMITS another owner’s PUBLIC DRAFT — the term a visibility-only predicate would leak', async () => {
        // W8-a.3: a free-tier draft is `visibility='public'`, so `viewableBy` alone admits it. This is why
        // the read composes `readableBy` rather than re-listing two of its three terms.
        const theirDraft = recipeId(901);
        await seedRecipe({ id: theirDraft, ownerId: OTHER_OWNER, visibility: 'public', status: 'draft' });

        const body = (await (await askFor([theirDraft])).json()) as NutritionBody;

        expect(body.nutrition).toStrictEqual({});
    });

    it('⛔ OMITS a tombstoned recipe, even the caller’s own', async () => {
        const erased = recipeId(902);
        await seedRecipe({ id: erased, deleted: true });

        const body = (await (await askFor([erased])).json()) as NutritionBody;

        expect(body.nutrition).toStrictEqual({});
    });

    it('⛔ REPORTS a recipe with no ingredient lines — an inner join would read as "not yours"', async () => {
        const empty = recipeId(903);
        await seedRecipe({ id: empty, ingredientId: null });

        const body = (await (await askFor([empty])).json()) as NutritionBody;

        expect(body.nutrition[empty]).toStrictEqual({ state: 'unaccounted', reason: 'no_resolved_ingredients' });
    });

    it('reports `no_resolved_ingredients` for a recipe whose lines map to no food', async () => {
        const freeform = recipeId(904);
        await seedRecipe({ id: freeform, ingredientId: FREEFORM_CATALOG_ID });

        const body = (await (await askFor([freeform])).json()) as NutritionBody;

        expect(body.nutrition[freeform]).toStrictEqual({ state: 'unaccounted', reason: 'no_resolved_ingredients' });
    });

    it('⛔ rejects an over-cap id list with a 400 carrying `details.fields`', async () => {
        const tooMany = Array.from({ length: MAX_NUTRITION_RECIPE_IDS + 1 }, (_value, index) => recipeId(index + 1));
        const response = await askFor(tooMany);

        expect(response.status).toBe(400);
        const body = (await response.json()) as { code: string; details?: { fields?: string[] } };

        // The published `VALIDATION_FAILED` arm promises `details.fields`. A client validating the error
        // against the service's own schema must be able to parse this body — the defect being avoided is a
        // cap raised with a bare message, which parses as nothing.
        expect(body.code).toBe('VALIDATION_FAILED');
        expect(body.details?.fields?.join(' ')).toContain('recipeIds');
    });

    it('rejects an empty id list — asking for nothing is not the same as having nothing', async () => {
        expect((await askFor([])).status).toBe(400);
    });

    it('⛔ answers 200 for a caller with an in-flight erasure — a POST-shaped READ is not a mutation', async () => {
        // `ErasureLockGuard` keys on the HTTP method, so without `@SkipErasureLock()` this route would 423
        // while every GET on the same page succeeded. Driven through the REAL guard on the booted app.
        await pool.query(
            `INSERT INTO account_erasure_jobs (owner_id, status) VALUES ($1, 'queued') ON CONFLICT DO NOTHING`,
            [OWNER],
        );

        try {
            expect((await askFor([recipeId(1)])).status).toBe(200);
        } finally {
            await pool.query(`DELETE FROM account_erasure_jobs WHERE owner_id = $1`, [OWNER]);
        }
    });
});
