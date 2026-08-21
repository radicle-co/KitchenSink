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
 * 2. Recipe's ingredient typeahead is populated BY THAT LIVE CATALOG — `catalogAvailability: 'ok'`, and
 *    every `catalog` suggestion's `foodId` is one food-service itself returned for the same query. If
 *    recipe could not reach food (or forwarded no credential) this reads `'unavailable'`, which is the
 *    exact value the absent-dependency specs assert — so a regression cannot pass BOTH suites.
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

import { foodNutritionBatchResponseSchema, searchResponseSchema, type FoodNutrition } from '@kitchensink/schema-food';
import {
    ingredientSchema,
    ingredientSuggestionsResponseSchema,
    recipeNutritionResponseSchema,
} from '@kitchensink/schema-recipe';
import { beforeAll, describe, expect, it } from 'vitest';

/** The credential artefact `mintLinkageCredentials.ts` writes; both services are booted against it. */
interface LinkageCredentials {
    readonly publicKeyPem: string;
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

/** The food record every downstream assertion is measured against — discovered, never hard-coded. */
let probe: FoodNutrition;
/** The query both services are asked the same question with. */
let query = '';
/** Every food id FOOD-SERVICE ITSELF returned for {@link query} — recipe's list must be a subset. */
let foodIdsForQuery: readonly string[] = [];

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
        // Ask BOTH services the same question, using the probe's own name so the two result sets are
        // comparable — the point of the next spec is that recipe's list IS food's list.
        const probeName = results.find((result) => result.id === probe.id)?.name ?? '';

        expect(probeName, 'food search did not report a name for the probe row').not.toBe('');

        query = probeName.split(',')[0] ?? probeName;

        const rerun = await call(`${FOOD_URL}/api/v1/foods/search?query=${encodeURIComponent(query)}`);

        expect(rerun.status).toBe(200);
        foodIdsForQuery = searchResponseSchema.parse(rerun.body).results.map((result) => result.id);

        expect(foodIdsForQuery.length).toBeGreaterThan(1);
    });
});

describe("recipe-service's ingredient typeahead is served by the LIVE food catalog", () => {
    // ⛔ THE assertion the degraded tier can never make. With food absent — or with no bearer to forward —
    // this field reads `'unavailable'`, which is exactly what the absent-dependency specs assert. The two
    // suites therefore cannot both pass on a broken link.
    it('reports catalogAvailability `ok` and returns catalog suggestions food itself produced', async () => {
        const suggest = await call(`${RECIPE_URL}/api/v1/ingredients/suggest?q=${encodeURIComponent(query)}`);

        expect(suggest.status, `recipe suggest failed: ${JSON.stringify(suggest.body)}`).toBe(200);

        const body = ingredientSuggestionsResponseSchema.parse(suggest.body);

        expect(
            body.catalogAvailability,
            'the recipe service could not reach the food catalog — this is the DEGRADED reading, not the linked one',
        ).toBe('ok');

        const catalogHits = body.suggestions.filter((suggestion) => suggestion.provenance === 'catalog');

        expect(
            catalogHits.length,
            'no catalog-provenance suggestion — nothing crossed the service boundary',
        ).toBeGreaterThan(0);

        // Every id recipe surfaced must be one food-service returned for the same query. A fabricated,
        // cached or locally-derived id fails here even though `catalogAvailability` would still say `ok`.
        for (const hit of catalogHits) {
            expect(
                foodIdsForQuery,
                `recipe surfaced foodId ${hit.foodId}, which food-service did not return`,
            ).toContain(hit.foodId);
        }
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
                ingredients: [{ ingredientId, name: 'linkage probe', quantity: grams, unit: 'g' }],
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
