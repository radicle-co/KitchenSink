/**
 * Unit tests for the draft's nutrition projections (`form/nutrition.ts`).
 *
 * ⚠️ These 3 describe blocks came from `model.test.ts`, which covered all of `form/model.ts`
 * before it was split into one module per concern. No assertion was changed, added or dropped in the
 * move — the suite is redistributed, not rewritten.
 */
import { describe, expect, it } from 'vitest';

import { makeFilledRecipeFormValues } from '../../__fixtures__/index.js';
import { computeRecipeNutrition } from '@kitchensink/recipe-core';
import { lineCalories, recipeNutritionTotal, toNutritionLine } from '../nutrition.js';
import type { RecipeFormIngredient } from '../values.js';

describe('toNutritionLine (E3 plumbing — form line -> the aggregator NutritionLine)', () => {
    const baseLine = (over: Partial<RecipeFormIngredient> = {}): RecipeFormIngredient => ({
        ingredientId: '00000000-0000-4000-8000-000000000001',
        name: 'Olive oil',
        quantity: 2,
        unit: 'tbsp',
        ...over,
    });

    it('maps the catalog per-100g branch (mass unit) with no user-override fields', () => {
        const line = baseLine({
            quantity: 300,
            unit: 'g',
            caloriesPer100g: 130,
            proteinGPer100g: 2.7,
            carbsGPer100g: 28,
            fatGPer100g: 0.3,
        });

        expect(toNutritionLine(line)).toEqual({
            quantity: { kind: 'exact', value: 300 },
            unit: 'g',
            caloriesPer100g: 130,
            proteinGPer100g: 2.7,
            carbsGPer100g: 28,
            fatGPer100g: 0.3,
        });
        // Round-trip through the real aggregator: 300g @ 130 cal/100g = 390 cal for this one line/serving.
        expect(computeRecipeNutrition([toNutritionLine(line)], 1)).toEqual({
            calories: 390,
            proteinG: 8.1,
            carbsG: 84,
            fatG: 0.9,
            isComplete: true,
        });
    });

    it('carries household portions so a volumetric/count unit converts through the real aggregator', () => {
        const line = baseLine({
            quantity: 2,
            unit: 'tablespoon',
            caloriesPer100g: 884,
            proteinGPer100g: 0,
            carbsGPer100g: 0,
            fatGPer100g: 100,
            portions: [{ unit: 'tablespoon', gramsPerUnit: 13.5 }],
        });

        expect(toNutritionLine(line).portions).toEqual([{ unit: 'tablespoon', gramsPerUnit: 13.5 }]);
        expect(computeRecipeNutrition([toNutritionLine(line)], 1).isComplete).toBe(true);
    });

    it('maps the freeform user-override branch, taking priority over any (absent) catalog data', () => {
        const line = baseLine({
            ingredientId: 'ing_free',
            name: 'Grandma’s spice mix',
            quantity: 1,
            unit: 'batch',
            userCalories: 45,
            userProteinG: 1,
            userCarbsG: 8,
            userFatG: 0.5,
        });

        expect(toNutritionLine(line)).toEqual({
            quantity: { kind: 'exact', value: 1 },
            unit: 'batch',
            userCalories: 45,
            userProteinG: 1,
            userCarbsG: 8,
            userFatG: 0.5,
        });
        expect(computeRecipeNutrition([toNutritionLine(line)], 1)).toEqual({
            calories: 45,
            proteinG: 1,
            carbsG: 8,
            fatG: 0.5,
            isComplete: true,
        });
    });

    it('maps an honestly-incomplete line (no user override, no resolved catalog nutrition) to isComplete: false', () => {
        // A freshly-picked line still PENDING catalog resolution, or a freeform line with no user nutrition yet.
        const line = baseLine({ resolutionStatus: 'PENDING' });

        expect(toNutritionLine(line)).toEqual({ quantity: { kind: 'exact', value: 2 }, unit: 'tbsp' });
        expect(computeRecipeNutrition([toNutritionLine(line)], 1).isComplete).toBe(false);
    });

    it('degrades an absent unit to an empty string rather than guessing — unconvertible, honestly incomplete', () => {
        const line: RecipeFormIngredient = {
            ingredientId: '00000000-0000-4000-8000-000000000002',
            name: 'Eggs',
            quantity: 3,
            caloriesPer100g: 155,
        };

        const nutritionLine = toNutritionLine(line);

        expect(nutritionLine.unit).toBe('');
        expect(computeRecipeNutrition([nutritionLine], 1).isComplete).toBe(false);
    });
});

describe('lineCalories (w3/e3 — per-row calorie figure)', () => {
    const baseLine = (over: Partial<RecipeFormIngredient> = {}): RecipeFormIngredient => ({
        ingredientId: '00000000-0000-4000-8000-000000000001',
        name: 'Olive oil',
        quantity: 2,
        unit: 'tbsp',
        ...over,
    });

    it('returns the resolved catalog line calories — the SAME number the aggregator itself computes', () => {
        const line = baseLine({
            quantity: 300,
            unit: 'g',
            caloriesPer100g: 130,
            proteinGPer100g: 2.7,
            carbsGPer100g: 28,
            fatGPer100g: 0.3,
        });

        expect(lineCalories(line)).toBe(computeRecipeNutrition([toNutritionLine(line)], 1).calories);
        expect(lineCalories(line)).toBe(390);
    });

    it('returns the freeform user-entered calories verbatim, including an honest zero', () => {
        const line = baseLine({ ingredientId: 'ing_free', userCalories: 45, userProteinG: 1 });

        expect(lineCalories(line)).toBe(45);

        const zeroCalorieLine = baseLine({ ingredientId: 'ing_water', name: 'Water', userCalories: 0 });

        expect(lineCalories(zeroCalorieLine)).toBe(0);
    });

    it('returns undefined (never a fake 0) for a line still resolving (no catalog nutrition yet)', () => {
        const line = baseLine({ resolutionStatus: 'PENDING' });

        expect(lineCalories(line)).toBeUndefined();
    });

    it('returns undefined for a catalog line whose unit cannot convert to grams (no portions)', () => {
        const line = baseLine({ quantity: 1, unit: 'clove', caloriesPer100g: 149 });

        expect(lineCalories(line)).toBeUndefined();
    });

    it('returns undefined for a seeded-without-nutrition line (edit-mode gap, RESOLVED but no per-100g)', () => {
        // A line seeded from RecipeIngredientView (an existing recipe's ingredients), which does not carry
        // per-100g nutrition — resolutionStatus is 'RESOLVED' but there is still nothing to compute from.
        const line = baseLine({ resolutionStatus: 'RESOLVED' });

        expect(lineCalories(line)).toBeUndefined();
    });
});

describe('recipeNutritionTotal (w3/e3 — the running per-serving total, one aggregator, no second rule)', () => {
    it('matches computeRecipeNutrition run directly over the same mapped lines', () => {
        const values = makeFilledRecipeFormValues({
            servings: 2,
            ingredients: [
                {
                    ingredientId: '00000000-0000-4000-8000-000000000001',
                    name: 'Arborio rice',
                    quantity: 300,
                    unit: 'g',
                    caloriesPer100g: 130,
                },
                {
                    ingredientId: '00000000-0000-4000-8000-000000000002',
                    name: 'Salt',
                    quantity: 5,
                    unit: 'g',
                    userCalories: 0,
                },
            ],
        });

        expect(recipeNutritionTotal(values)).toEqual(
            computeRecipeNutrition(values.ingredients.map(toNutritionLine), values.servings),
        );
    });

    it('sums complete lines to a definite total and flags isComplete: true when every line is accounted for', () => {
        const values = makeFilledRecipeFormValues({
            servings: 1,
            ingredients: [
                {
                    ingredientId: '00000000-0000-4000-8000-000000000001',
                    name: 'Arborio rice',
                    quantity: 300,
                    unit: 'g',
                    caloriesPer100g: 130,
                    proteinGPer100g: 2.7,
                    carbsGPer100g: 28,
                    fatGPer100g: 0.3,
                },
                {
                    ingredientId: '00000000-0000-4000-8000-000000000002',
                    name: 'Custom spice',
                    quantity: 1,
                    userCalories: 30,
                    userProteinG: 1,
                },
            ],
        });

        expect(recipeNutritionTotal(values)).toEqual({
            calories: 420,
            proteinG: 9.1,
            carbsG: 84,
            fatG: 0.9,
            isComplete: true,
        });
    });

    it('flags isComplete: false and still sums every ACCOUNTABLE line when one line cannot be computed', () => {
        const values = makeFilledRecipeFormValues({
            servings: 1,
            ingredients: [
                {
                    ingredientId: '00000000-0000-4000-8000-000000000001',
                    name: 'Arborio rice',
                    quantity: 300,
                    unit: 'g',
                    caloriesPer100g: 130,
                },
                // Still resolving — no catalog nutrition yet, no user override: excluded, never a fake 0.
                {
                    ingredientId: '00000000-0000-4000-8000-000000000002',
                    name: 'Stock',
                    quantity: 1,
                    unit: 'cup',
                    resolutionStatus: 'PENDING',
                },
            ],
        });

        const total = recipeNutritionTotal(values);

        expect(total.isComplete).toBe(false);
        expect(total.calories).toBe(390); // the rice's contribution alone — the unresolved line is excluded.
    });

    it('returns a zero, complete total for an empty ingredient list (no lines to fail on)', () => {
        expect(recipeNutritionTotal(makeFilledRecipeFormValues({ ingredients: [] }))).toEqual({
            calories: 0,
            proteinG: 0,
            carbsG: 0,
            fatG: 0,
            isComplete: true,
        });
    });
});
