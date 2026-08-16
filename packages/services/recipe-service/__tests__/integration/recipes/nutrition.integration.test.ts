/**
 * Per-serving nutrition end to end, AFTER U10 (real booted app + Docker Postgres + a stubbed food origin).
 *
 * ⛔ WHY THIS TEST HAD TO BE REWRITTEN RATHER THAN PATCHED. It used to seed per-100g nutrition and a
 * `{ unit: 'cup', gramsPerUnit: 125 }` portion INTO the `ingredients` row and assert the recipe detail
 * scaled from them — proving "jsonb round-trip → IngredientsDal.findByIds → computeRecipeNutrition". Plan
 * U10 dropped every one of those columns, so that path no longer exists. Editing the test just enough to
 * COMPILE (which is what I did first) left it seeding an ingredient with no nutrition and asserting numbers
 * nothing could produce — a test that proves nothing while still being counted.
 *
 * What it proves now is the replacement path, and it is the ONLY tier that can: unit tests mock the food
 * client, so they cannot catch a real column that is still selected, a migration that did not apply, or a
 * URL the food service would reject. This exercises:
 *
 *   real Postgres (post-0019 schema) → IngredientsDal (reference columns only) → FoodNutritionGateway →
 *   a real HTTP round trip to a stubbed food origin → food's published response shape → the recipe's
 *   per-serving computation.
 *
 * The food origin is stubbed at the HTTP boundary rather than mocked in-process ON PURPOSE: the request
 * URL is part of the contract (ADR-0020 keys food's CDN cache on it), so this asserts the exact path and
 * query the recipe service emits, which an in-process mock would let drift silently.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import pg from 'pg';

import { bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from '../../../tests/e2e/harness.js';
import { createRecipeDrizzle, type RecipeDrizzle } from '../../../src/database/client.js';
import { ingredients } from '../../../src/database/schema/index.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];
const OWNER = '01JNUTRITIONOWNER00000000A';
const FLOUR_CATALOG_ID = '00000000-0000-4000-8000-00000000f100';
const FLOUR_FOOD_ID = '01JFOODNUTRITIONFLOUR00001';
/** A second ingredient whose food the gateway has never cached — the cold-cache degrade path. */
const UNCACHED_CATALOG_ID = '00000000-0000-4000-8000-00000000f200';
const UNCACHED_FOOD_ID = '01JFOODNUTRITIONUNCACHED01';

interface RecipeBody {
    id: string;
    hasPartialNutrition: boolean;
    leadCaloriesPerServing?: number;
    nutrition: { calories: number; proteinG: number; carbsG: number; fatG: number; isComplete: boolean };
}

/** Every nutrition request the recipe service issued, so the URL contract can be asserted. */
const requestedUrls: string[] = [];

/**
 * A stub standing in for the food service's `GET /api/v1/foods/nutrition`.
 *
 * @returns The listening server and its origin.
 */
async function startFoodStub(): Promise<{ server: Server; origin: string }> {
    const server = createServer((req, res) => {
        requestedUrls.push(req.url ?? '');

        if ((req.url ?? '').startsWith('/api/v1/foods/nutrition')) {
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

describe.skipIf(!hasDatabaseUrl)('per-serving nutrition from the food service (integration, post-U10)', () => {
    let booted: BootedRecipeApp;
    let baseUrl: string;
    let pool: pg.Pool;
    let db: RecipeDrizzle;
    let foodStub: Server;

    beforeAll(async () => {
        const stub = await startFoodStub();
        foodStub = stub.server;
        process.env['FOOD_SERVICE_URL'] = stub.origin;

        booted = await bootRecipeApp({ devAuthUserId: OWNER });
        baseUrl = booted.baseUrl;
        pool = new pg.Pool({ connectionString: DATABASE_URL });
        db = createRecipeDrizzle(pool);

        // ⚠️ REFERENCE COLUMNS ONLY. If migration 0019 has not applied, this insert still succeeds (the
        // dropped columns are nullable) — which is exactly why the ASSERTIONS below, not this seed, are
        // what prove the new path.
        await db
            .insert(ingredients)
            .values({
                id: FLOUR_CATALOG_ID,
                name: 'Nutrition Flour',
                foodId: FLOUR_FOOD_ID,
                foodResolutionStatus: 'RESOLVED',
                isUserEntered: false,
            })
            .onConflictDoNothing();

        await db
            .insert(ingredients)
            .values({
                id: UNCACHED_CATALOG_ID,
                name: 'Uncached Flour',
                foodId: UNCACHED_FOOD_ID,
                foodResolutionStatus: 'RESOLVED',
                isUserEntered: false,
            })
            .onConflictDoNothing();
    });

    afterAll(async () => {
        await pool.end();
        await booted.close();
        await new Promise<void>((resolve) => foodStub.close(() => resolve()));
    });

    it('⛔ the dropped columns are GONE from the live schema (migration 0019 actually applied)', async () => {
        // The one assertion no unit test can make. A schema that still carries them means the migration did
        // not run, and the service would be reading a table it no longer matches.
        const { rows } = await pool.query<{ column_name: string }>(
            `SELECT column_name FROM information_schema.columns
              WHERE table_name = 'ingredients' AND column_name = ANY($1)`,
            [['calories_per_100g', 'protein_g_per_100g', 'carbs_g_per_100g', 'fat_g_per_100g', 'portions']],
        );

        expect(rows.map((r) => r.column_name)).toStrictEqual([]);

        const recipeCols = await pool.query<{ column_name: string }>(
            `SELECT column_name FROM information_schema.columns
              WHERE table_name = 'recipes' AND column_name = ANY($1)`,
            [['lead_calories_per_serving', 'has_partial_nutrition']],
        );

        expect(recipeCols.rows.map((r) => r.column_name)).toStrictEqual([]);
    });

    it('computes per-serving nutrition from FOOD`s live response, through a real HTTP round trip', async () => {
        const createRes = await fetch(`${baseUrl}/api/v1/recipes`, {
            method: 'POST',
            // A bearer MUST be present for nutrition to resolve: the recipe service forwards the caller's
            // own credential so FOOD authorizes the read (it never substitutes another). Without one the
            // gateway takes its degrade path and reports nutrition ABSENT — see the next test, which pins
            // that so the two outcomes can never be confused for each other.
            headers: { 'content-type': 'application/json', authorization: 'Bearer integration-caller-token' },
            body: JSON.stringify({
                title: 'Nutrition Cup Recipe',
                servings: 2,
                prepTimeMinutes: 5,
                cookTimeMinutes: 10,
                totalTimeMinutes: 15,
                tags: [],
                dietaryFlags: [],
                // 2 cups × 125 g/cup = 250 g at 350 cal/100 g → 875 cal; ÷ 2 servings → 437.5.
                // Identical arithmetic to the pre-U10 test — the SOURCE of the inputs changed, the numbers
                // a user sees must not.
                ingredients: [{ ingredientId: FLOUR_CATALOG_ID, name: 'Nutrition Flour', quantity: 2, unit: 'cups' }],
                steps: [{ instruction: 'Mix.' }],
            }),
        });

        expect(createRes.status).toBe(201);
        const created = (await createRes.json()) as RecipeBody;

        expect(created.nutrition).toEqual({
            calories: 437.5,
            proteinG: 15,
            carbsG: 87.5,
            fatG: 2.5,
            isComplete: true,
        });
    });

    it('requests the CANONICAL nutrition URL — the edge cache key (ADR-0020)', () => {
        // Food's CDN keys on the URL alone, so a non-canonical list (unsorted, duplicated) is a second cache
        // entry for identical data. An in-process mock could never catch this.
        const nutritionCalls = requestedUrls.filter((url) => url.startsWith('/api/v1/foods/nutrition'));

        expect(nutritionCalls.length).toBeGreaterThan(0);
        expect(nutritionCalls[0]).toBe(`/api/v1/foods/nutrition?ids=${FLOUR_FOOD_ID}`);
    });

    it('⛔ renders nutrition-ABSENT (never zero) for a food the catalog does not know', async () => {
        // KTD-3b's degrade branch, asserted on the OUTCOME rather than on plumbing. Two earlier versions of
        // this test were wrong and both are worth recording:
        //
        //  1. It first used a CACHED food. With a warm cache a degraded read correctly serves STALE — that
        //     is the feature — so "absent" was the wrong expectation entirely.
        //  2. It then asserted "no food request was issued when no bearer is sent". That is the harness's
        //     behaviour, not this service's contract: the dev-auth boot supplies a caller regardless, so the
        //     assertion measured the test rig.
        //
        // What the service actually promises is this: when food yields nothing for an ingredient, the recipe
        // still renders and reports nutrition as NOT accounted — never `calories: 0`, which is a factual
        // claim that this food contains no energy.

        const res = await fetch(`${baseUrl}/api/v1/recipes`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                title: 'No Credential Recipe',
                servings: 2,
                prepTimeMinutes: 5,
                cookTimeMinutes: 10,
                totalTimeMinutes: 15,
                tags: [],
                dietaryFlags: [],
                ingredients: [{ ingredientId: UNCACHED_CATALOG_ID, name: 'Uncached Flour', quantity: 2, unit: 'cups' }],
                steps: [{ instruction: 'Mix.' }],
            }),
        });

        expect(res.status).toBe(201);
        const body = (await res.json()) as RecipeBody;

        expect(body.nutrition.isComplete).toBe(false);
        expect(body.hasPartialNutrition).toBe(true);
        // ⛔ The distinction that matters: unaccounted, not "contains zero calories".
        expect(body.leadCaloriesPerServing).toBeUndefined();
    });
});
