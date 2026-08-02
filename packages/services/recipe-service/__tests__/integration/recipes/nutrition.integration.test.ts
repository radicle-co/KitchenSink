/**
 * #9 + #11 — per-serving nutrition end to end (real booted app + Docker Postgres).
 *
 * Seeds a food-backed catalog ingredient WITH per-100g nutrition and a household-measure portion
 * (`{ unit: 'cup', gramsPerUnit: 125 }`, stored as `jsonb`), then creates a recipe that measures it in a
 * VOLUMETRIC unit (`cups`) and asserts the recipe detail's per-serving `nutrition` is computed by scaling
 * per-100g via that portion — proving the whole path: jsonb round-trip → `IngredientsDal.findByIds` →
 * `computeRecipeNutrition`. Guarded with `describe.skipIf(!hasDatabaseUrl)`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from '../../../tests/e2e/harness.js';
import { createRecipeDrizzle, type RecipeDrizzle } from '../../../src/database/client.js';
import { ingredients } from '../../../src/database/schema/index.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];
const OWNER = '01JNUTRITIONOWNER00000000A';
const FLOUR_CATALOG_ID = '00000000-0000-4000-8000-00000000f100';

interface RecipeBody {
    id: string;
    nutrition: { calories: number; proteinG: number; carbsG: number; fatG: number; isComplete: boolean };
}

describe.skipIf(!hasDatabaseUrl)('per-serving nutrition via a stored portion (integration)', () => {
    let booted: BootedRecipeApp;
    let baseUrl: string;
    let pool: pg.Pool;
    let db: RecipeDrizzle;

    beforeAll(async () => {
        booted = await bootRecipeApp({ devAuthUserId: OWNER });
        baseUrl = booted.baseUrl;
        pool = new pg.Pool({ connectionString: DATABASE_URL });
        db = createRecipeDrizzle(pool);

        // A resolved food-backed ingredient: 350 cal / 100 g, and one cup weighs 125 g.
        await db
            .insert(ingredients)
            .values({
                id: FLOUR_CATALOG_ID,
                name: 'Nutrition Flour',
                foodId: 'food-nutri-1',
                foodResolutionStatus: 'RESOLVED',
                isUserEntered: false,
                caloriesPer100g: '350',
                proteinGPer100g: '12',
                carbsGPer100g: '70',
                fatGPer100g: '2',
                portions: [{ unit: 'cup', gramsPerUnit: 125 }],
            })
            .onConflictDoNothing();
    });

    afterAll(async () => {
        await pool.end();
        await booted.close();
    });

    it('scales per-100g nutrition by a matching portion for a volumetric unit', async () => {
        const createRes = await fetch(`${baseUrl}/api/v1/recipes`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                title: 'Nutrition Cup Recipe',
                servings: 2,
                prepTimeMinutes: 5,
                cookTimeMinutes: 10,
                totalTimeMinutes: 15,
                tags: [],
                dietaryFlags: [],
                // 2 cups × 125 g/cup = 250 g at 350 cal/100g → 875 cal; /2 servings → 437.5.
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
});
