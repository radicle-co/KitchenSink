/**
 * Contract-conformance test for the RECIPE read shape (DIVERGENCE #6).
 *
 * Drives the REAL `@kitchensink/recipe-service-client` against the REAL booted app so the recipe body the
 * server returns is proven to conform to `recipe-core`'s canonical `Recipe`. Historically the server's
 * `RecipeResponse` diverged — `version` vs `currentVersion`, nullable prep/cook/total times, and it OMITTED
 * `sourceType`/`hasSubstantiveEdit` — so `recipeSchema.safeParse` failed on every
 * recipe body and a consumer reading `recipe.currentVersion` got `undefined`. This suite parses the GET
 * body against the canonical `recipeSchema` (the check that was missing), which now passes.
 *
 * The recipe is seeded through the typed client end to end (create fully conforms after #5 + #8). Runs
 * only when the harness DB is configured.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RecipeServiceClient } from '@kitchensink/recipe-service-client';
import { recipeDetailSchema, recipeSchema } from '@kitchensink/recipe-core';

import { bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from '../../../tests/e2e/harness.js';

/** The dev-bypass owner ULID this suite creates recipes as. */
const OWNER = '01JRECIPECONTRACT00000000A';

/** A seeded catalog ingredient (Flour) from the baseline global setup. */
const FLOUR_ID = '00000000-0000-4000-8000-0000000000aa';

describe.skipIf(!hasDatabaseUrl)('recipe read shape — client ↔ server contract conformance', () => {
    let booted: BootedRecipeApp;
    let client: RecipeServiceClient;
    let recipeId: string;

    beforeAll(async () => {
        booted = await bootRecipeApp({ devAuthUserId: OWNER });
        client = new RecipeServiceClient({ baseUrl: booted.baseUrl });

        const recipe = await client.createRecipe({
            title: 'Recipe Contract Dish',
            servings: 4,
            prepTimeMinutes: 15,
            cookTimeMinutes: 30,
            totalTimeMinutes: 45,
            tags: ['contract'],
            dietaryFlags: [],
            // A user-entered nutrition override (FR-007a) so the per-serving aggregation (#9) is exercised
            // end to end — 4 servings → the totals below divide by 4.
            ingredients: [
                {
                    ingredientId: FLOUR_ID,
                    name: 'Flour',
                    quantity: { kind: 'exact', value: 2 },
                    unit: 'cup',
                    userCalories: 200,
                    userProteinG: 8,
                    userCarbsG: 40,
                    userFatG: 2,
                },
            ],
            steps: [{ instruction: 'Mix.' }],
        });
        recipeId = recipe.id;
    });

    afterAll(async () => {
        await booted.close();
    });

    it('returns a recipe body that conforms to the canonical recipe-core Recipe schema', async () => {
        const recipe = await client.getRecipeById(recipeId);

        // The whole body parses against the canonical schema (extra detail fields are additive, tolerated).
        expect(recipeSchema.safeParse(recipe).success).toBe(true);

        // The previously-divergent fields are present with the canonical names + non-null values.
        expect(recipe.currentVersion).toBe(1); // was emitted as `version`
        expect(recipe.prepTimeMinutes).toBe(15); // was `number | null`
        expect(recipe.cookTimeMinutes).toBe(30);
        expect(recipe.totalTimeMinutes).toBe(45);
        expect(recipe.sourceType).toBe('user_created'); // was omitted
        expect(recipe.hasSubstantiveEdit).toBe(false); // was omitted
    });

    it('returns the cookable content (ingredients + steps) as a typed RecipeDetail (#6b)', async () => {
        const recipe = await client.getRecipeById(recipeId);

        // The full detail — everything a cook needs — parses against `recipeDetailSchema`.
        expect(recipeDetailSchema.safeParse(recipe).success).toBe(true);

        // Ingredients are the typed view: catalog name, quantity/unit, and the user-entered badge flag.
        expect(recipe.ingredients).toHaveLength(1);
        expect(recipe.ingredients[0]?.name).toBe('Flour');
        expect(recipe.ingredients[0]?.quantity).toEqual({ kind: 'exact', value: 2 });
        expect(recipe.ingredients[0]?.isUserEntered).toBe(true);

        // Steps are the typed view: 1-based number + instruction.
        expect(recipe.steps).toHaveLength(1);
        expect(recipe.steps[0]?.stepNumber).toBe(1);
        expect(recipe.steps[0]?.instruction).toBe('Mix.');

        // Photos are embedded (empty for a fresh recipe) — the detail is one round-trip (#10).
        expect(Array.isArray(recipe.photos)).toBe(true);
        expect(recipe.photos).toHaveLength(0);

        // Per-serving nutrition (#9): the single user-entered line's macros ÷ 4 servings, fully accounted.
        expect(recipe.nutrition).toEqual({
            calories: 50,
            proteinG: 2,
            carbsG: 10,
            fatG: 0.5,
            isComplete: true,
        });
    });
});
