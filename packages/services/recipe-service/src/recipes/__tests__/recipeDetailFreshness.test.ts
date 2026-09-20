/**
 * ⛔ The recipe DETAIL says when its nutrition is stale (owner ruling 2026-09-12).
 *
 * The food gateway knows, per food, whether it fetched a figure for this read or served its cached copy
 * because the food service could not be reached — and the deferred card batch carries that as `freshness`.
 * The detail read computes its figure from the same entries; dropping the fact would report a figure served
 * from cache during an outage as current (KTD-3b's "serve stale, MARKED") on the one surface that shows the
 * whole figure.
 *
 * Asserted through the real assembler over a gateway double, so what is proven is the wiring: the entry's
 * freshness reaching the line, and the line-level rule deciding the reading.
 */
import { describe, expect, it, vi } from 'vitest';

import { makeRecipeIngredientRow, makeRecipeRow, makeRecipeStepRow } from '../../__fixtures__/index.js';
import { CallerToken } from '../../auth/CallerToken.js';
import { makeIngredient } from '../../ingredients/__fixtures__/ingredients.fixtures.js';
import type { IngredientsDal } from '../../ingredients/dal/ingredients.dal.js';
import type { FoodNutritionGateway, FoodNutritionLookup } from '../../ingredients/foodNutrition.gateway.js';
import { makeRecipeDetailAssembler, permissiveIngredientsDal } from '../__fixtures__/recipeDetailAssembler.fixture.js';
import type { RecipeAggregate } from '../dal/recipes.dal.js';

const CATALOG_ID = '00000000-0000-4000-8000-00000000fe01';
const FOOD_ID = '01JFRESHNESSFOOD0000000001';

/** A one-line, one-serving recipe of 100 g of the catalog food — optionally carrying the cook's own numbers. */
function aggregate(userCalories?: string): RecipeAggregate {
    const recipe = makeRecipeRow({ servings: 1 });

    return {
        recipe,
        steps: [makeRecipeStepRow({ recipeId: recipe.id, stepNumber: 1, instruction: 'Mix' })],
        ingredients: [
            makeRecipeIngredientRow({
                recipeId: recipe.id,
                ingredientId: CATALOG_ID,
                quantity: '100',
                unit: 'g',
                ...(userCalories === undefined ? {} : { userCalories }),
            }),
        ],
    };
}

/** A gateway that answers the food with flour's figures, marked as this read's `freshness`. */
function gatewayServing(freshness: 'fresh' | 'stale'): FoodNutritionGateway {
    const answer: FoodNutritionLookup = {
        byFoodId: new Map([
            [
                FOOD_ID,
                {
                    caloriesPer100g: 364,
                    proteinGPer100g: 10,
                    carbsGPer100g: 76,
                    fatGPer100g: 1,
                    portions: [],
                    freshness,
                },
            ],
        ]),
        degraded: freshness === 'stale',
    };

    return { lookup: vi.fn().mockResolvedValue(answer) } as unknown as FoodNutritionGateway;
}

/** The catalog DAL, with the line's ingredient bound to the food. */
function catalogBoundToFood(): IngredientsDal {
    return {
        ...permissiveIngredientsDal(),
        findByIds: vi.fn().mockResolvedValue([makeIngredient({ id: CATALOG_ID, name: 'Flour', foodId: FOOD_ID })]),
    } as unknown as IngredientsDal;
}

/** Read the detail over a gateway serving the food at `freshness`. */
async function detailOver(freshness: 'fresh' | 'stale', userCalories?: string) {
    const assembler = makeRecipeDetailAssembler({
        ingredientsDal: catalogBoundToFood(),
        foodNutrition: gatewayServing(freshness),
    });

    return assembler.toDetailResponse(aggregate(userCalories), [], {
        budget: 'read',
        caller: CallerToken.fromAuthorizationHeader('Bearer freshness-caller'),
        viewerId: '01JFRESHNESSVIEWER00000001',
    });
}

describe('RecipeDetailAssembler — nutrition freshness on the detail', () => {
    it('⛔ marks the detail STALE when the figure came from a food served from cache', async () => {
        const detail = await detailOver('stale');

        expect(detail.nutrition).toMatchObject({ calories: 364, freshness: 'stale' });
    });

    it('marks it FRESH when the food was fetched for this read', async () => {
        const detail = await detailOver('fresh');

        expect(detail.nutrition).toMatchObject({ calories: 364, freshness: 'fresh' });
    });

    it('⛔ stays FRESH when the stale food sits behind the cook’s own numbers, which drew on no food data', async () => {
        const detail = await detailOver('stale', '120');

        expect(detail.nutrition).toMatchObject({ calories: 120, freshness: 'fresh' });
    });
});
