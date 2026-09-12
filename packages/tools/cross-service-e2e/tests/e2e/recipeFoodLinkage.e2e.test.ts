/**
 * ⛔ THE PROOF THAT DID NOT EXIST: recipe-service and food-service, both LIVE, actually linked.
 *
 * ## Why this suite is here
 *
 * Before it, **no CI job anywhere ran the two services together.** Every recipe tier points
 * `FOOD_SERVICE_URL` at a port nothing listens on, ON PURPOSE — `recipe-service/tests/e2e/harness.ts`
 * says so in as many words ("Nothing listens here, which is what makes the F2 specs below a real
 * absent-dependency proof") — and `heavy-e2e.yml` records that the food service "is never booted". Those
 * degraded-path specs are correct and are deliberately left untouched by this file.
 *
 * The consequence was that the SUCCESS path had no coverage at all. Recipe detail nutrition comes FROM
 * the food service, so every nutrition figure a user has ever seen was produced by a path no test had
 * exercised successfully. Green checks proved only that recipe degrades gracefully when food is absent.
 *
 * ## What is actually proven here, and why each assertion can fail
 *
 * 1. Food serves REAL catalog rows to the caller's Clerk bearer.
 * 2. A pick from the typeahead binds through recipe: the apps search food's catalog directly (plan 002 S5) and
 *    hand recipe the id it returned, so recipe must bind exactly that food. The bind crosses the boundary as the
 *    caller, so a recipe that could not reach food, or forwarded no credential, fails it.
 * 3. An ingredient RESOLVES to a real food record: `foodId` set, `foodResolutionStatus: 'RESOLVED'`,
 *    `isUserEntered: false` — not a freeform row. A dead food service answers this call with a 400
 *    `UNKNOWN_INGREDIENT`.
 * 4. A recipe's nutrition figures are DERIVED from that live lookup: every macro equals the per-100 g
 *    value food-service itself reported, scaled by the line's grams and the serving count. Not merely
 *    `state: 'known'` — the NUMBERS are checked against food's own response, so a recipe that invented,
 *    cached, or zeroed them fails. `freshness: 'fresh'` is asserted too, because the stale-cache
 *    degradation would otherwise satisfy `known`.
 *
 * ## Why a real Clerk token, and why the dev bypass would make this vacuous
 *
 * Recipe calls food AS THE CALLER — it forwards the caller's own verified bearer, and there is
 * deliberately no service credential (`recipe-service/src/auth/CallerToken.ts`). Under recipe's dev-auth
 * bypass there is no bearer to forward, so `FoodCatalogGateway` degrades to `'unavailable'` WITHOUT
 * ISSUING A REQUEST — a suite written that way would "pass" its degraded assertions with a live food
 * service sitting untouched beside it. So both services here verify one throwaway Clerk key
 * (`scripts/mintLinkageCredentials.ts`) and the spec sends a genuinely signed bearer.
 *
 * ## Configuration
 *
 * `LINKAGE_RECIPE_URL`, `LINKAGE_FOOD_URL` and `LINKAGE_CREDENTIALS` are REQUIRED. A missing one throws
 * rather than skipping: a tier that quietly passes when its dependencies are absent is the failure this
 * whole suite exists to remove.
 */
import { readFileSync } from 'node:fs';

import {
    catalogSearchResponseSchema,
    foodErrorSchema,
    foodNutritionBatchResponseSchema,
    foodResponseSchema,
    searchResponseSchema,
    type FoodNutrition,
} from '@kitchensink/schema-food';
import {
    ingredientFoodNutritionResponseSchema,
    ingredientSchema,
    recipeNutritionResponseSchema,
} from '@kitchensink/schema-recipe';
import { beforeAll, describe, expect, it } from 'vitest';

/** The credential artefact `mintLinkageCredentials.ts` writes — a real token from the STAGE's own Clerk. */
interface LinkageCredentials {
    readonly token: string;
    readonly azp: string;
    readonly sub: string;
    readonly externalId: string;
}

/**
 * Read a required environment value, or throw naming it.
 *
 * @param name - The variable to read.
 * @returns Its value.
 */
function required(name: string): string {
    const value = process.env[name];

    if (value === undefined || value.trim() === '') {
        throw new Error(
            `${name} is required. This tier drives two LIVE services; without it there is nothing to ` +
                'prove, and skipping would restore exactly the blind spot it was written to close.',
        );
    }

    return value;
}

const RECIPE_URL = required('LINKAGE_RECIPE_URL').replace(/\/+$/, '');
const FOOD_URL = required('LINKAGE_FOOD_URL').replace(/\/+$/, '');
const credentials = JSON.parse(readFileSync(required('LINKAGE_CREDENTIALS'), 'utf-8')) as LinkageCredentials;

/** The bearer the spec sends to recipe — and which recipe forwards, unchanged, to food. */
const AUTH = { authorization: `Bearer ${credentials.token}` } as const;

/**
 * The wire's stated precision for a nutrition figure: one decimal place. Mirrored here only so an
 * expected value can be compared for EQUALITY instead of with a tolerance that could mask a real drift.
 * It is arithmetic about the comparison, not a second copy of the nutrition rule.
 *
 * @param value - The unrounded figure.
 * @returns The figure at one decimal place.
 */
function round1(value: number): number {
    return Math.round(value * 10) / 10;
}

/**
 * Issue a request and return its status and parsed JSON body.
 *
 * @param url - Absolute URL.
 * @param init - Fetch options; the caller's bearer is always added.
 * @returns The HTTP status and the decoded body.
 * @sideEffect Performs a network request.
 */
async function call(url: string, init: RequestInit = {}): Promise<{ status: number; body: unknown }> {
    const response = await fetch(url, {
        ...init,
        headers: {
            ...AUTH,
            ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
            ...init.headers,
        },
    });

    const text = await response.text();

    return { status: response.status, body: text === '' ? undefined : JSON.parse(text) };
}

/**
 * The existing food a `409` from food's authored-food create names: the caller already authored one by that name.
 *
 * @param body - The `409` body.
 * @returns The existing food's id.
 * @throws {Error} When the refusal is anything but the duplicate-name one.
 */
function existingIdOf(body: unknown): string {
    const refusal = foodErrorSchema.parse(body);

    if (refusal.code !== 'DUPLICATE_AUTHORED_NAME') {
        throw new Error(`food refused the authored food: ${refusal.code}`);
    }

    return refusal.details.existingId;
}

/** The food record every downstream assertion is measured against — discovered, never hard-coded. */
let probe: FoodNutrition;
/** The typeahead's query: the probe's own name, so food's catalog search has something to find. */
let query = '';

beforeAll(async () => {
    for (const [name, base] of [
        ['recipe', RECIPE_URL],
        ['food', FOOD_URL],
    ] as const) {
        const health = await fetch(`${base}/health`);

        if (health.status !== 200) {
            throw new Error(`${name} service is not serving at ${base}/health (HTTP ${health.status}).`);
        }
    }
});

describe('food-service serves REAL catalog rows to the caller credential recipe will forward', () => {
    it('answers a search with resolved foods, and a nutrition batch with per-100 g macros', async () => {
        const search = await call(`${FOOD_URL}/api/v1/foods/search?query=${encodeURIComponent('chicken breast')}`);

        expect(search.status, `food search failed: ${JSON.stringify(search.body)}`).toBe(200);

        const results = searchResponseSchema.parse(search.body).results;

        expect(results.length, 'the seeded food catalog returned nothing — the fixture did not load').toBeGreaterThan(
            1,
        );

        const ids = results.map((result) => result.id);
        const nutrition = await call(`${FOOD_URL}/api/v1/foods/nutrition?ids=${[...ids].sort().join(',')}`);

        expect(nutrition.status).toBe(200);

        const foods = foodNutritionBatchResponseSchema.parse(nutrition.body).foods;

        // A food whose seeded energy is 0 would make every downstream figure vacuously "correct at zero".
        const usable = foods.find(
            (food) =>
                food.status === 'RESOLVED' &&
                food.caloriesPer100g !== undefined &&
                food.caloriesPer100g > 0 &&
                food.proteinGPer100g !== undefined &&
                food.carbsGPer100g !== undefined &&
                food.fatGPer100g !== undefined,
        );

        expect(usable, 'no seeded food carried a non-zero per-100 g energy value').toBeDefined();

        probe = usable as FoodNutrition;
        const probeName = results.find((result) => result.id === probe.id)?.name ?? '';

        expect(probeName, 'food search did not report a name for the probe row').not.toBe('');

        query = probeName.split(',')[0] ?? probeName;
    });
});

describe('a pick from the typeahead’s catalog search binds through recipe-service (plan 002 S5)', () => {
    // The apps search food's catalog themselves and give recipe the id it returned. Recipe binding exactly that food,
    // as the caller, is the link between the two services that the typeahead now depends on.
    it('binds the food food’s own catalog search returned, and no other', async () => {
        const search = await call(`${FOOD_URL}/api/v1/foods/catalog/search?query=${encodeURIComponent(query)}`);

        expect(search.status, `food catalog search failed: ${JSON.stringify(search.body)}`).toBe(200);

        // Recipe refuses to bind a nameless food, so the pick is the first result with a name.
        const pick = catalogSearchResponseSchema.parse(search.body).results.find((result) => result.name !== null);

        if (pick === undefined) {
            throw new Error(`food's catalog search offered no named food for "${query}", the probe's own name`);
        }

        const bound =
            pick.variant === undefined
                ? await call(`${RECIPE_URL}/api/v1/ingredients/by-food`, {
                      method: 'POST',
                      body: JSON.stringify({ foodId: pick.id }),
                  })
                : await call(`${RECIPE_URL}/api/v1/ingredients/by-food-variant`, {
                      method: 'POST',
                      body: JSON.stringify({ foodVariantId: pick.variant.id }),
                  });

        expect(bound.status, `recipe could not bind food's pick: ${JSON.stringify(bound.body)}`).toBe(200);

        const ingredient = ingredientSchema.parse(bound.body);

        expect(ingredient.foodId, 'recipe bound a food other than the one food’s search returned').toBe(pick.id);
        expect(ingredient.variant?.id).toBe(pick.variant?.id);
        expect(ingredient.foodResolutionStatus).toBe('RESOLVED');
    });
});

describe('an ingredient RESOLVES to a real food record, not a freeform row', () => {
    /** The recipe-side ingredient id minted by admitting the probe food. */
    let ingredientId = '';

    it('admits the food catalog row and links it', async () => {
        const admitted = await call(`${RECIPE_URL}/api/v1/ingredients/by-food`, {
            method: 'POST',
            body: JSON.stringify({ foodId: probe.id }),
        });

        expect(admitted.status, `by-food failed: ${JSON.stringify(admitted.body)}`).toBe(200);

        const ingredient = ingredientSchema.parse(admitted.body);

        expect(ingredient.foodId, 'the ingredient is not linked to the food record').toBe(probe.id);
        expect(ingredient.foodResolutionStatus).toBe('RESOLVED');
        expect(ingredient.isUserEntered, 'this must be a catalog-backed row, not a freeform one').toBe(false);

        ingredientId = ingredient.id;
    });

    /**
     * ⛔ U3, ACROSS THE REAL BOUNDARY: the shared catalog's display name is FOOD-SERVICE's, not the caller's.
     *
     * `ingredients` has no `owner_id`, so whatever name a row carries is served to every user's typeahead. The
     * 448-recipe import wrote the caller's own string there — from the picker a search term, from the importer
     * a fragment of recipe prose — and ~900 of 2,432 lines then resolved against that polluted corpus. U3 moves
     * the decision to the only party that can settle it.
     *
     * The name is fetched from FOOD here rather than reused from the earlier spec's `results`, so this compares
     * two services' live answers rather than a recipe row against a value this file already holds — which is
     * the difference between proving the linkage and restating a local variable.
     */
    it('takes its display name from FOOD-SERVICE, verified against food`s own live answer', async () => {
        expect(ingredientId, 'the previous spec did not admit an ingredient').not.toBe('');

        const fromFood = await call(`${FOOD_URL}/api/v1/foods/${probe.id}`);

        expect(fromFood.status, `food read failed: ${JSON.stringify(fromFood.body)}`).toBe(200);

        const goldenName = (fromFood.body as { name: string | null }).name;

        expect(goldenName, 'food-service published no name for the probe row').not.toBeNull();

        const fromRecipe = await call(`${RECIPE_URL}/api/v1/ingredients/${ingredientId}/status`);

        expect(fromRecipe.status).toBe(200);
        expect(
            ingredientSchema.parse(fromRecipe.body).name,
            'the recipe-side catalog row is not carrying food-service`s canonical name',
        ).toBe(goldenName);
    });

    // ⛔ THE OWNER'S QUESTION, answered on the wire: the numbers a user sees come from the live lookup.
    it("derives the recipe's nutrition figures from food-service's own per-100 g values", async () => {
        expect(ingredientId, 'the previous spec did not admit an ingredient').not.toBe('');

        const grams = 1000;
        const servings = 5;
        const created = await call(`${RECIPE_URL}/api/v1/recipes`, {
            method: 'POST',
            body: JSON.stringify({
                title: 'Cross-service linkage proof',
                // ⛔ The WIRE shape, spelled out rather than built through `statedQuantity` — this suite
                // exists to prove what actually crosses the boundary, so routing the body through a helper
                // that could itself be wrong would defeat it. U8 made `quantity` a discriminated union
                // (`exact | range | absent`); this line still sent a bare number and the service answered
                // `400 ingredients.0.quantity: expected object, received number`. It went unnoticed because
                // this whole job had never executed — `ci-pr` produced zero jobs from 2026-08-19 until the
                // `runner`-context fix earlier on this branch.
                // No `name`: a line is named by following its binding (plan 002 R9), so the body is refused with one.
                ingredients: [{ ingredientId, quantity: { kind: 'exact', value: grams }, unit: 'g' }],
                steps: [{ instruction: 'Prove the two services are wired together.' }],
                servings,
                prepTimeMinutes: 1,
                cookTimeMinutes: 1,
                totalTimeMinutes: 2,
            }),
        });

        expect(created.status, `recipe create failed: ${JSON.stringify(created.body)}`).toBe(201);

        const recipeId = (created.body as { id: string }).id;
        const batch = await call(`${RECIPE_URL}/api/v1/recipes/nutrition-batch`, {
            method: 'POST',
            body: JSON.stringify({ recipeIds: [recipeId] }),
        });

        expect(batch.status, `nutrition-batch failed: ${JSON.stringify(batch.body)}`).toBe(200);

        const reading = recipeNutritionResponseSchema.parse(batch.body).nutrition[recipeId];

        expect(reading, 'the recipe was omitted from the nutrition map').toBeDefined();
        expect(
            reading?.state,
            `nutrition is UNACCOUNTED — the live food lookup did not contribute: ${JSON.stringify(reading)}`,
        ).toBe('known');

        if (reading?.state !== 'known') {
            return;
        }

        // `stale` would mean the figures came from the gateway's LRU fallback after a failed call — which
        // is a degradation, not the linkage this suite exists to prove.
        expect(reading.freshness, 'the figures came from a stale cache, not a live lookup').toBe('fresh');
        expect(reading.isComplete).toBe(true);

        // The proof itself: recipe's numbers are FOOD's numbers, scaled by the line and the servings.
        const factor = grams / 100 / servings;

        expect(reading.caloriesPerServing).toBe(round1((probe.caloriesPer100g ?? 0) * factor));
        expect(reading.proteinG).toBe(round1((probe.proteinGPer100g ?? 0) * factor));
        expect(reading.carbsG).toBe(round1((probe.carbsGPer100g ?? 0) * factor));
        expect(reading.fatG).toBe(round1((probe.fatGPer100g ?? 0) * factor));
        // …and they are not all zero, which would satisfy the equalities above vacuously.
        expect(reading.caloriesPerServing).toBeGreaterThan(0);
    });
});

/**
 * The batch food nutrition read (plan 002 U9) across the live boundary: food's own figures, as the caller.
 *
 * ⚠️ One credential, so this proves the author's side of R46 only: the caller's own private food is `found`. The
 * stranger's side — another user's private food answering exactly as an unknown id — needs a second test principal,
 * and is proven by the mocked integration tier and the unit tier until one exists.
 */
describe('recipe-service serves food’s own per-100 g figures for a batch of food refs', () => {
    /** The food-nutrition read, as the caller. */
    async function foodNutrition(refs: readonly { kind: 'root' | 'variant'; id: string }[]) {
        const response = await call(`${RECIPE_URL}/api/v1/ingredients/food-nutrition`, {
            method: 'POST',
            body: JSON.stringify({ refs }),
        });

        expect(response.status, `food-nutrition failed: ${JSON.stringify(response.body)}`).toBe(200);

        return ingredientFoodNutritionResponseSchema.parse(response.body).entries;
    }

    it('answers the probe found and fresh, with food’s own figures, and an unknown id absent', async () => {
        const [found, unknown] = await foodNutrition([
            { kind: 'root', id: probe.id },
            // Answered by food with nothing, so `absent` — never `unavailable`, which would mean food was not asked.
            { kind: 'root', id: '01JLINKAGEUNKNOWNFOOD000000' },
        ]);

        expect(found).toMatchObject({
            outcome: 'found',
            freshness: 'fresh',
            caloriesPer100g: probe.caloriesPer100g,
            proteinGPer100g: probe.proteinGPer100g,
            carbsGPer100g: probe.carbsGPer100g,
            fatGPer100g: probe.fatGPer100g,
        });
        expect(unknown).toStrictEqual({ outcome: 'absent', ref: { kind: 'root', id: '01JLINKAGEUNKNOWNFOOD000000' } });
    });

    it('answers the caller’s own PRIVATE food found, through food’s per-caller route', async () => {
        // A fixed name, so a repeat run reuses the caller's existing food (food's duplicate refusal names it) instead
        // of adding one. Authored at food, as the apps do (plan 002 S5).
        const authored = await call(`${FOOD_URL}/api/v1/foods/authored`, {
            method: 'POST',
            body: JSON.stringify({
                name: 'Linkage private spice blend',
                macros: { calories: 250, proteinG: 10, carbsG: 40, fatG: 5 },
            }),
        });

        expect([201, 409], `authored food create failed: ${JSON.stringify(authored.body)}`).toContain(authored.status);

        const foodId =
            authored.status === 201 ? foodResponseSchema.parse(authored.body).id : existingIdOf(authored.body);
        const [own] = await foodNutrition([{ kind: 'root', id: foodId }]);

        expect(own).toMatchObject({ outcome: 'found', freshness: 'fresh', caloriesPer100g: 250 });
    });
});

/**
 * A line bound to a VARIANT, across the live boundary (curated plan U9; AE1, R20, R21).
 *
 * The root is KTD-16's "beef brisket", one of the two roots the deployed tests use with their variants. The variant
 * is DISCOVERED from food's own root read, never hard-coded, and is one whose energy differs from its root's, so the
 * figures below can only match if recipe asked food about the variant and not its root.
 *
 * Every food deploy applies the curated seed (ADR-0051), so a stage with no such variant failed its deploy. This case
 * fails naming that cause, as `catalogSeed.e2e.test.ts` does, and never skips: a skip here would report a linkage
 * nobody tested.
 */
describe('a line bound to a VARIANT carries the variant’s own figures (curated U9)', () => {
    /** At most this many search hits are read for their variants. */
    const ROOTS_TO_READ = 5;

    it('binds a live variant through recipe and derives the recipe’s figures from the variant, not its root', async () => {
        const search = await call(`${FOOD_URL}/api/v1/foods/search?query=${encodeURIComponent('beef brisket')}`);

        expect(search.status, `food search failed: ${JSON.stringify(search.body)}`).toBe(200);

        let chosen: { readonly rootId: string; readonly variantId: string } | undefined;

        for (const hit of searchResponseSchema.parse(search.body).results.slice(0, ROOTS_TO_READ)) {
            const read = await call(`${FOOD_URL}/api/v1/foods/${encodeURIComponent(hit.id)}`);

            if (read.status !== 200) {
                continue;
            }

            const root = foodResponseSchema.parse(read.body);
            const rootCalories = (await nutritionOf([root.id]))[0]?.caloriesPer100g;
            const distinct = root.variants.find(
                (variant) => variant.caloriesPer100g !== undefined && variant.caloriesPer100g !== rootCalories,
            );

            if (distinct !== undefined) {
                chosen = { rootId: root.id, variantId: distinct.id };
                break;
            }
        }

        if (chosen === undefined) {
            throw new Error(
                'this stage’s catalog holds no "beef brisket" root with a variant whose energy differs from it: the ' +
                    'curated seed (ADR-0051, KTD-16) did not reach this stage',
            );
        }

        const [variantFigures] = await nutritionOf([chosen.variantId]);

        expect(variantFigures?.caloriesPer100g, 'food reported no energy for the variant').toBeGreaterThan(0);

        const bound = await call(`${RECIPE_URL}/api/v1/ingredients/by-food-variant`, {
            method: 'POST',
            body: JSON.stringify({ foodVariantId: chosen.variantId }),
        });

        expect(bound.status, `by-food-variant failed: ${JSON.stringify(bound.body)}`).toBe(200);

        const ingredient = ingredientSchema.parse(bound.body);

        expect(ingredient.foodId, 'the line does not name the variant’s live root').toBe(chosen.rootId);
        expect(ingredient.variant?.id, 'the line is not bound to the variant').toBe(chosen.variantId);

        const grams = 1000;
        const servings = 5;
        const created = await call(`${RECIPE_URL}/api/v1/recipes`, {
            method: 'POST',
            body: JSON.stringify({
                title: 'Cross-service variant linkage proof',
                ingredients: [{ ingredientId: ingredient.id, quantity: { kind: 'exact', value: grams }, unit: 'g' }],
                steps: [{ instruction: 'Prove a variant line reads the variant.' }],
                servings,
                prepTimeMinutes: 1,
                cookTimeMinutes: 1,
                totalTimeMinutes: 2,
            }),
        });

        expect(created.status, `recipe create failed: ${JSON.stringify(created.body)}`).toBe(201);

        const recipeId = (created.body as { id: string }).id;
        const batch = await call(`${RECIPE_URL}/api/v1/recipes/nutrition-batch`, {
            method: 'POST',
            body: JSON.stringify({ recipeIds: [recipeId] }),
        });

        expect(batch.status, `nutrition-batch failed: ${JSON.stringify(batch.body)}`).toBe(200);

        const reading = recipeNutritionResponseSchema.parse(batch.body).nutrition[recipeId];

        expect(reading?.state, `the variant line contributed nothing: ${JSON.stringify(reading)}`).toBe('known');

        if (reading?.state !== 'known') {
            return;
        }

        // The variant's own figures, scaled exactly as the probe's are. Its root's energy differs by construction.
        expect(reading.freshness).toBe('fresh');
        expect(reading.caloriesPerServing).toBe(
            round1((variantFigures?.caloriesPer100g ?? 0) * (grams / 100 / servings)),
        );
    });
});

/**
 * Food's own nutrition batch for these ids, as the caller.
 *
 * @param ids - Root or variant ids: one namespace.
 * @returns Food's entries.
 * @sideEffect Performs a network request.
 */
async function nutritionOf(ids: readonly string[]): Promise<readonly FoodNutrition[]> {
    const response = await call(`${FOOD_URL}/api/v1/foods/nutrition?ids=${[...ids].sort().join(',')}`);

    expect(response.status, `food nutrition failed: ${JSON.stringify(response.body)}`).toBe(200);

    return foodNutritionBatchResponseSchema.parse(response.body).foods;
}
