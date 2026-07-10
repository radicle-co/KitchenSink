/**
 * Unit tests for {@link computeRecipeNutrition} (FR-007 / FR-007a) — the pure per-serving aggregator.
 *
 * Pins the accounting rules mutation-resistantly: user overrides win over catalog nutrition, catalog
 * lines scale per-100g by MASS only, unaccountable lines flip `isComplete` (and are excluded from the
 * sum), and the total is divided by servings.
 */
import { describe, it, expect } from 'vitest';

import { computeRecipeNutrition, type NutritionLine } from '../nutrition.js';

describe('computeRecipeNutrition', () => {
    it('sums a user-entered override line (absolute) and divides by servings', () => {
        const lines: NutritionLine[] = [
            { quantity: 1, unit: 'scoop', userCalories: 200, userProteinG: 30, userCarbsG: 10, userFatG: 5 },
        ];

        expect(computeRecipeNutrition(lines, 2)).toEqual({
            calories: 100,
            proteinG: 15,
            carbsG: 5,
            fatG: 2.5,
            isComplete: true,
        });
    });

    it('treats macros the user left blank on an override line as 0 (still accounted)', () => {
        const lines: NutritionLine[] = [{ quantity: 1, unit: 'each', userCalories: 90 }];

        expect(computeRecipeNutrition(lines, 1)).toEqual({
            calories: 90,
            proteinG: 0,
            carbsG: 0,
            fatG: 0,
            isComplete: true,
        });
    });

    it('scales catalog per-100g nutrition by mass (grams) for a mass unit', () => {
        // 200 g at 350 cal/100g → 700 cal; /2 servings → 350.
        const lines: NutritionLine[] = [
            { quantity: 200, unit: 'g', caloriesPer100g: 350, proteinGPer100g: 12, carbsGPer100g: 70, fatGPer100g: 2 },
        ];

        expect(computeRecipeNutrition(lines, 2)).toEqual({
            calories: 350,
            proteinG: 12,
            carbsG: 70,
            fatG: 2,
            isComplete: true,
        });
    });

    it('converts non-gram mass units (kg, oz) before scaling', () => {
        const kg: NutritionLine[] = [{ quantity: 1, unit: 'kg', caloriesPer100g: 100 }];
        // 1 kg = 1000 g → ×10 of per-100g → 1000 cal; 1 serving.
        expect(computeRecipeNutrition(kg, 1).calories).toBe(1000);

        const oz: NutritionLine[] = [{ quantity: 1, unit: 'oz', caloriesPer100g: 100 }];
        // 1 oz = 28.3495 g → 28.3495 cal → round1 → 28.3.
        expect(computeRecipeNutrition(oz, 1).calories).toBe(28.3);
    });

    it('cannot account a CATALOG line in a non-mass unit with NO matching portion → excluded + isComplete false', () => {
        const lines: NutritionLine[] = [{ quantity: 2, unit: 'cup', caloriesPer100g: 350 }];

        expect(computeRecipeNutrition(lines, 1)).toEqual({
            calories: 0,
            proteinG: 0,
            carbsG: 0,
            fatG: 0,
            isComplete: false,
        });
    });

    it('accounts a CATALOG line in a volumetric unit via a matching portion (#11)', () => {
        // 2 cups × 125 g/cup = 250 g at 350 cal/100g → 875 cal; /1 serving.
        const lines: NutritionLine[] = [
            { quantity: 2, unit: 'cups', caloriesPer100g: 350, portions: [{ unit: 'cup', gramsPerUnit: 125 }] },
        ];

        expect(computeRecipeNutrition(lines, 1)).toEqual({
            calories: 875,
            proteinG: 0,
            carbsG: 0,
            fatG: 0,
            isComplete: true,
        });
    });

    it('cannot account a line with neither a user override nor catalog nutrition → isComplete false', () => {
        const lines: NutritionLine[] = [{ quantity: 100, unit: 'g' }];

        expect(computeRecipeNutrition(lines, 1).isComplete).toBe(false);
    });

    it('prefers the user override over catalog nutrition on the same line', () => {
        const lines: NutritionLine[] = [{ quantity: 100, unit: 'g', userCalories: 5, caloriesPer100g: 999 }];

        expect(computeRecipeNutrition(lines, 1).calories).toBe(5);
    });

    it('sums accounted lines while flagging the mix as incomplete when one line is unaccountable', () => {
        const lines: NutritionLine[] = [
            { quantity: 100, unit: 'g', caloriesPer100g: 100, proteinGPer100g: 10 }, // 100 cal, 10 g protein
            { quantity: 1, unit: 'clove', caloriesPer100g: 50 }, // non-mass → excluded
        ];

        const result = computeRecipeNutrition(lines, 1);
        expect(result.calories).toBe(100);
        expect(result.proteinG).toBe(10);
        expect(result.isComplete).toBe(false);
    });

    it('returns a zero, complete total for a recipe with no ingredient lines', () => {
        expect(computeRecipeNutrition([], 4)).toEqual({
            calories: 0,
            proteinG: 0,
            carbsG: 0,
            fatG: 0,
            isComplete: true,
        });
    });
});
