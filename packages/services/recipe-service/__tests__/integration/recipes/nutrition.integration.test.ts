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

import { asPrincipal, bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from '../../../tests/e2e/harness.js';
import { createRecipeDrizzle, type RecipeDrizzle } from '../../../src/database/client.js';
import { ingredients } from '../../../src/database/schema/index.js';
import { recipeDb } from '../../../tests/support/roleDb.js';

const roleDb = recipeDb();
const OWNER = '01JNUTRITIONOWNER00000000A';
const FLOUR_CATALOG_ID = '00000000-0000-4000-8000-00000000f100';
const FLOUR_FOOD_ID = '01JFOODNUTRITIONFLOUR00001';
/** A second ingredient whose food the gateway has never cached — the cold-cache degrade path. */
const UNCACHED_CATALOG_ID = '00000000-0000-4000-8000-00000000f200';
const UNCACHED_FOOD_ID = '01JFOODNUTRITIONUNCACHED01';

/**
 * One COLD food per write route that answers with a detail body. Each is fetched for the first time by the
 * route under test, which is what lets the assertion tell a forwarded credential from a warm cache: with no
 * caller the gateway serves the in-process cache (stale-allowed), so a food any earlier request fetched
 * would render its figure whether or not the route forwarded anything.
 */
const WRITE_ROUTE_FOODS = {
    update: { catalogId: '00000000-0000-4000-8000-00000000f301', foodId: '01JFOODNUTRITIONWRITEUPD01' },
    visibility: { catalogId: '00000000-0000-4000-8000-00000000f302', foodId: '01JFOODNUTRITIONWRITEVIS01' },
    clone: { catalogId: '00000000-0000-4000-8000-00000000f303', foodId: '01JFOODNUTRITIONWRITECLN01' },
    restore: { catalogId: '00000000-0000-4000-8000-00000000f304', foodId: '01JFOODNUTRITIONWRITERST01' },
    rating: { catalogId: '00000000-0000-4000-8000-00000000f305', foodId: '01JFOODNUTRITIONWRITERAT01' },
} as const;

/** Food's published per-100g figures for flour — the same numbers for every stubbed food. */
const FLOUR_FIGURES = {
    status: 'RESOLVED',
    caloriesPer100g: 350,
    proteinGPer100g: 12,
    carbsGPer100g: 70,
    fatGPer100g: 2,
    portions: [{ unit: 'cup', gramsPerUnit: 125 }],
} as const;

interface RecipeBody {
    id: string;
    nutrition: { calories: number; proteinG: number; carbsG: number; fatG: number; isComplete: boolean };
}

/** The one bearer the food stub accepts — every test that expects resolved nutrition sends exactly this. */
const FORWARDED_BEARER = 'Bearer integration-caller-token';

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
            // ⛔ Refuse any credential but the one the tests send, so a route that SUBSTITUTED a credential
            // rather than forwarding the caller's cannot pass for one that forwarded it.
            if (req.headers['authorization'] !== FORWARDED_BEARER) {
                res.writeHead(401).end();

                return;
            }

            const requested = new URL(req.url ?? '', 'http://stub').searchParams.get('ids')?.split(',') ?? [];
            const writeRouteFoods = Object.values(WRITE_ROUTE_FOODS)
                .filter(({ foodId }) => requested.includes(foodId))
                .map(({ foodId }) => ({ id: foodId, ...FLOUR_FIGURES }));

            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(
                JSON.stringify({
                    foods: [{ id: FLOUR_FOOD_ID, ...FLOUR_FIGURES }, ...writeRouteFoods],
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

        booted = await bootRecipeApp({ databaseUrl: roleDb.appUrl, devAuthUserId: OWNER });
        baseUrl = booted.baseUrl;
        pool = new pg.Pool({ connectionString: roleDb.appUrl });
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

        for (const [route, { catalogId, foodId }] of Object.entries(WRITE_ROUTE_FOODS)) {
            await db
                .insert(ingredients)
                .values({
                    id: catalogId,
                    name: `Write Route Flour (${route})`,
                    foodId,
                    foodResolutionStatus: 'RESOLVED',
                    isUserEntered: false,
                })
                .onConflictDoNothing();
        }
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
            headers: { 'content-type': 'application/json', authorization: FORWARDED_BEARER },
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
                ingredients: [
                    {
                        ingredientId: FLOUR_CATALOG_ID,
                        name: 'Nutrition Flour',
                        quantity: { kind: 'exact', value: 2 },
                        unit: 'cups',
                    },
                ],
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

        // ⛔ ONE representation of this recipe's calories, not two. The detail body used to ALSO carry
        // `leadCaloriesPerServing: 437.5` — the same number, derived from the same computation, under a
        // second name. That was the survivor U10 removed everywhere else (ADR-0021's "Follow-up owed"): a
        // reader had two keys to choose from and no rule for which one wins, and any future divergence
        // between them would be silent. `nutrition.calories` is the detail's figure; a CARD's figure comes
        // from `POST /api/v1/recipes/nutrition-batch`. This is the ONLY tier that can prove the SERIALIZED
        // body carries no second key — a unit test asserts on a value the mapper returns, not on the JSON.
        expect(created).not.toHaveProperty('leadCaloriesPerServing');
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
                ingredients: [
                    {
                        ingredientId: UNCACHED_CATALOG_ID,
                        name: 'Uncached Flour',
                        quantity: { kind: 'exact', value: 2 },
                        unit: 'cups',
                    },
                ],
                steps: [{ instruction: 'Mix.' }],
            }),
        });

        expect(res.status).toBe(201);
        const body = (await res.json()) as RecipeBody;

        expect(body.nutrition.isComplete).toBe(false);
        // ⛔ The distinction that matters: unaccounted, not "contains zero calories". REWRITTEN from
        // `expect(body.leadCaloriesPerServing).toBeUndefined()` to prove the stronger NEW rule: the key is
        // not on the wire AT ALL, so there is no longer a second place a fabricated `0` could appear. The
        // absent-never-zero invariant itself is unchanged and still asserted here — by `isComplete: false`
        // with no calorie key anywhere in the body — and, for a card, by the `unaccounted` member of the
        // deferred union (`nutritionBatch.integration.test.ts`).
        expect(body).not.toHaveProperty('leadCaloriesPerServing');
        // REWRITTEN, not deleted. This line used to assert `hasPartialNutrition === true`. That field has
        // left the wire: it was a two-valued encoding of a three-valued fact, pinned `true` at three call
        // sites to mean "not looked up" — which is not what it meant. The invariant it carried here is
        // unchanged and still asserted, by `nutrition.isComplete === false` above and the absent calorie
        // figure; what moved is the ACCOUNTED-NESS signal for a CARD, which is now the discriminated state
        // from `POST /api/v1/recipes/nutrition-batch` (covered by `nutritionBatch.integration.test.ts`).
        expect(body).not.toHaveProperty('hasPartialNutrition');
    });
    /**
     * ⛔ EVERY WRITE THAT ANSWERS WITH A RECIPE BODY FORWARDS THE CALLER, not just create and GET.
     *
     * `PATCH /recipes/{id}`, `PATCH /recipes/{id}/visibility`, `POST /recipes/{id}/clone`,
     * `POST /recipes/{id}/versions/{n}/restore` and `PUT /recipes/{id}/rating` all answer with the full
     * detail. None of them forwarded the caller's credential — `update` and `setVisibility` took no parameter
     * for it, the clone route dropped the one `clone` accepted, restore reached `update` through
     * `VersionsService`, and a rating re-read through `getById` — so each answered with nutrition resolved
     * from the in-process cache ALONE. On a cold cache that is nutrition-absent, which a
     * client cannot tell from a food outage; on a warm one it is a stale figure reported as current.
     *
     * Each case creates its recipe WITHOUT a bearer, so its food has never been fetched and the precondition
     * (`isComplete: false`) proves the cache is cold. The figure the route then returns can only have come
     * from a credential that route forwarded.
     */
    describe('write routes forward the caller, so their detail body carries resolved nutrition', () => {
        const BEARER = { 'content-type': 'application/json', authorization: FORWARDED_BEARER };
        const RESOLVED = { calories: 437.5, proteinG: 15, carbsG: 87.5, fatG: 2.5, isComplete: true };

        /**
         * Create a public two-serving recipe of two cups of one route's food, with NO bearer.
         *
         * @param catalogId - The catalog ingredient the one line binds.
         * @returns The created recipe body, asserted to carry cold-cache (incomplete) nutrition.
         * @sideEffect Creates a recipe through the booted app.
         */
        async function createCold(catalogId: string): Promise<RecipeBody> {
            const res = await fetch(`${baseUrl}/api/v1/recipes`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    title: `Write Route Recipe ${catalogId.slice(-3)}`,
                    servings: 2,
                    prepTimeMinutes: 5,
                    cookTimeMinutes: 10,
                    totalTimeMinutes: 15,
                    visibility: 'public',
                    tags: [],
                    dietaryFlags: [],
                    ingredients: [
                        {
                            ingredientId: catalogId,
                            name: 'Write Route Flour',
                            quantity: { kind: 'exact', value: 2 },
                            unit: 'cups',
                        },
                    ],
                    steps: [{ instruction: 'Mix.' }],
                }),
            });

            expect(res.status).toBe(201);
            const body = (await res.json()) as RecipeBody;

            expect(body.nutrition.isComplete, 'precondition: the food must be cold before the route runs').toBe(false);

            return body;
        }

        it('PATCH /recipes/{id}', async () => {
            const created = await createCold(WRITE_ROUTE_FOODS.update.catalogId);

            const res = await fetch(`${baseUrl}/api/v1/recipes/${created.id}`, {
                method: 'PATCH',
                headers: BEARER,
                body: JSON.stringify({ expectedVersion: 1, title: 'Renamed With A Caller' }),
            });

            expect(res.status).toBe(200);
            expect(((await res.json()) as RecipeBody).nutrition).toEqual(RESOLVED);
        });

        it('PATCH /recipes/{id}/visibility', async () => {
            const created = await createCold(WRITE_ROUTE_FOODS.visibility.catalogId);

            const res = await fetch(`${baseUrl}/api/v1/recipes/${created.id}/visibility`, {
                method: 'PATCH',
                headers: BEARER,
                body: JSON.stringify({ visibility: 'public' }),
            });

            expect(res.status).toBe(200);
            expect(((await res.json()) as RecipeBody).nutrition).toEqual(RESOLVED);
        });

        it('POST /recipes/{id}/clone', async () => {
            const created = await createCold(WRITE_ROUTE_FOODS.clone.catalogId);

            const res = await fetch(`${baseUrl}/api/v1/recipes/${created.id}/clone`, {
                method: 'POST',
                headers: BEARER,
                body: JSON.stringify({}),
            });

            expect(res.status).toBe(201);
            expect(((await res.json()) as RecipeBody).nutrition).toEqual(RESOLVED);
        });

        it('POST /recipes/{id}/versions/{n}/restore', async () => {
            const created = await createCold(WRITE_ROUTE_FOODS.restore.catalogId);

            const res = await fetch(`${baseUrl}/api/v1/recipes/${created.id}/versions/1/restore`, {
                method: 'POST',
                headers: BEARER,
                body: JSON.stringify({}),
            });

            expect(res.status).toBe(200);
            expect(((await res.json()) as { recipe: RecipeBody }).recipe.nutrition).toEqual(RESOLVED);
        });

        it('PUT /recipes/{id}/rating', async () => {
            const created = await createCold(WRITE_ROUTE_FOODS.rating.catalogId);

            // A cook cannot rate their own recipe, so a second principal rates the owner's public one.
            const res = await asPrincipal('01JNUTRITIONRATER00000000A', () =>
                fetch(`${baseUrl}/api/v1/recipes/${created.id}/rating`, {
                    method: 'PUT',
                    headers: BEARER,
                    body: JSON.stringify({ stars: 4 }),
                }),
            );

            expect(res.status).toBe(200);
            expect(((await res.json()) as RecipeBody).nutrition).toEqual(RESOLVED);
        });
    });
});
