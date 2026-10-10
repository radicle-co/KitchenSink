/**
 * Unit tests for {@link computeRecipeNutrition} (FR-007 / FR-007a) — the pure per-serving aggregator.
 *
 * Pins the accounting rules mutation-resistantly: user overrides win over catalog nutrition, catalog
 * lines scale per-100g by MASS only, unaccountable lines flip `isComplete` (and are excluded from the
 * sum), and the total is divided by servings.
 */
import { describe, it, expect } from 'vitest';

import { ABSENT_QUANTITY, statedQuantity, type IngredientQuantity } from '../ingredientQuantity.js';
import {
    computeRecipeNutrition,
    hasUserEnteredIngredients,
    toNutritionLine,
    type NutritionLine,
} from '../nutrition.js';

/** A quantity the source stated exactly. */
function exact(value: number): IngredientQuantity {
    const quantity = statedQuantity(value);

    if (quantity === null) {
        throw new Error(`test fixture: ${value} is not a statable amount`);
    }

    return quantity;
}

/** A quantity the source stated as two bounds. */
function range(low: number, high: number): IngredientQuantity {
    const quantity = statedQuantity(low, high);

    if (quantity === null) {
        throw new Error(`test fixture: ${low}..${high} is not a statable range`);
    }

    return quantity;
}

/**
 * R38 + R40 — how the aggregator reads the two quantity members a scalar could not express.
 *
 * The honesty posture is the point. A collapsed range must SAY it was collapsed and NAME the bound, because
 * a figure computed from `2 cups` when the line said `2 to 3 cups` is up to a third under and looks
 * identical to an exact one; and an unquantified line must be excluded rather than counted as `0`, because
 * counting it as zero is a claim the source never made.
 */
describe('computeRecipeNutrition — ranged and absent quantities', () => {
    it('computes a catalog line from the LOWER bound of a range and names that bound (R38)', () => {
        const lines: NutritionLine[] = [{ quantity: range(2, 3), unit: 'g', caloriesPer100g: 100 }];

        expect(computeRecipeNutrition(lines, 1)).toEqual({
            calories: 2,
            proteinG: 0,
            carbsG: 0,
            fatG: 0,
            isComplete: true,
            rangeDerivedBound: 'low',
        });
    });

    // Mutation lens: an implementation that marked the reading but used the UPPER bound would still carry
    // the marker, so the marker alone proves nothing. The figure must match the bound it names.
    it('reports the figure the named bound actually produces, not merely that a range was present', () => {
        const low = computeRecipeNutrition([{ quantity: range(2, 3), unit: 'g', caloriesPer100g: 100 }], 1);
        const asExactLow = computeRecipeNutrition([{ quantity: exact(2), unit: 'g', caloriesPer100g: 100 }], 1);
        const asExactHigh = computeRecipeNutrition([{ quantity: exact(3), unit: 'g', caloriesPer100g: 100 }], 1);

        expect(low.calories).toBe(asExactLow.calories);
        expect(low.calories).not.toBe(asExactHigh.calories);
    });

    it('leaves the marker ABSENT when no line stated a range, so an exact reading claims nothing', () => {
        const reading = computeRecipeNutrition([{ quantity: exact(200), unit: 'g', caloriesPer100g: 100 }], 1);

        expect(reading.rangeDerivedBound).toBeUndefined();
        expect('rangeDerivedBound' in reading).toBe(false);
    });

    it('marks the whole reading when ANY contributing line was ranged', () => {
        const reading = computeRecipeNutrition(
            [
                { quantity: exact(100), unit: 'g', caloriesPer100g: 100 },
                { quantity: range(50, 80), unit: 'g', caloriesPer100g: 200 },
            ],
            1,
        );

        expect(reading).toMatchObject({ calories: 200, isComplete: true, rangeDerivedBound: 'low' });
    });

    // A per-line user override (FR-007a) is ABSOLUTE for the line — it is not derived from the quantity at
    // all — so a range on such a line collapses nothing and there is nothing to disclose.
    it('does not mark a reading whose ranged line was accounted by a user override', () => {
        const reading = computeRecipeNutrition([{ quantity: range(2, 3), unit: 'g', userCalories: 90 }], 1);

        expect(reading).toEqual({ calories: 90, proteinG: 0, carbsG: 0, fatG: 0, isComplete: true });
    });

    // ⛔ R40. A line the source left unquantified has no mass, so it cannot be scaled from per-100g values.
    // Counting it as `0` would report a complete total that silently omits an ingredient.
    it('excludes an ABSENT-quantity catalog line and flips isComplete, never counting it as zero', () => {
        const lines: NutritionLine[] = [
            { quantity: exact(100), unit: 'g', caloriesPer100g: 100 },
            { quantity: ABSENT_QUANTITY, unit: '', caloriesPer100g: 700 },
        ];

        expect(computeRecipeNutrition(lines, 1)).toMatchObject({ calories: 100, isComplete: false });
    });

    it('does not mark an unaccountable ranged line as range-derived — it contributed nothing', () => {
        const reading = computeRecipeNutrition([{ quantity: range(2, 3), unit: 'clove', caloriesPer100g: 100 }], 1);

        expect(reading).toEqual({ calories: 0, proteinG: 0, carbsG: 0, fatG: 0, isComplete: false });
    });

    // An absolute per-line override needs no quantity at all: "butter the size of an egg, 100 kcal" is a
    // complete statement. Excluding it would punish the user for the source's vagueness.
    it('still accounts an ABSENT-quantity line that carries a user override', () => {
        const reading = computeRecipeNutrition([{ quantity: ABSENT_QUANTITY, unit: '', userCalories: 100 }], 1);

        expect(reading).toEqual({ calories: 100, proteinG: 0, carbsG: 0, fatG: 0, isComplete: true });
    });
});

describe('computeRecipeNutrition', () => {
    it('sums a user-entered override line (absolute) and divides by servings', () => {
        const lines: NutritionLine[] = [
            { quantity: exact(1), unit: 'scoop', userCalories: 200, userProteinG: 30, userCarbsG: 10, userFatG: 5 },
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
        const lines: NutritionLine[] = [{ quantity: exact(1), unit: 'each', userCalories: 90 }];

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
            {
                quantity: exact(200),
                unit: 'g',
                caloriesPer100g: 350,
                proteinGPer100g: 12,
                carbsGPer100g: 70,
                fatGPer100g: 2,
            },
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
        const kg: NutritionLine[] = [{ quantity: exact(1), unit: 'kg', caloriesPer100g: 100 }];
        // 1 kg = 1000 g → ×10 of per-100g → 1000 cal; 1 serving.
        expect(computeRecipeNutrition(kg, 1).calories).toBe(1000);

        const oz: NutritionLine[] = [{ quantity: exact(1), unit: 'oz', caloriesPer100g: 100 }];
        // 1 oz = 28.3495 g → 28.3495 cal → round1 → 28.3.
        expect(computeRecipeNutrition(oz, 1).calories).toBe(28.3);
    });

    it('cannot account a CATALOG line in a non-mass unit with NO matching portion → excluded + isComplete false', () => {
        const lines: NutritionLine[] = [{ quantity: exact(2), unit: 'cup', caloriesPer100g: 350 }];

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
            { quantity: exact(2), unit: 'cups', caloriesPer100g: 350, portions: [{ unit: 'cup', gramsPerUnit: 125 }] },
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
        const lines: NutritionLine[] = [{ quantity: exact(100), unit: 'g' }];

        expect(computeRecipeNutrition(lines, 1).isComplete).toBe(false);
    });

    it('prefers the user override over catalog nutrition on the same line', () => {
        const lines: NutritionLine[] = [{ quantity: exact(100), unit: 'g', userCalories: 5, caloriesPer100g: 999 }];

        expect(computeRecipeNutrition(lines, 1).calories).toBe(5);
    });

    it('sums accounted lines while flagging the mix as incomplete when one line is unaccountable', () => {
        const lines: NutritionLine[] = [
            { quantity: exact(100), unit: 'g', caloriesPer100g: 100, proteinGPer100g: 10 }, // 100 cal, 10 g protein
            { quantity: exact(1), unit: 'clove', caloriesPer100g: 50 }, // non-mass → excluded
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

/*
 * ⛔ The `describe('leadCaloriesPerServing')` suite that stood here was DELETED with the function it covered
 * (ADR-0021's "Follow-up owed"). Four tests went; here is exactly where each one's coverage lives now, so
 * nothing was dropped on the floor:
 *
 *  - "is the per-serving calorie term of the aggregate (single source)" — vacuous once there is only one
 *    function. `computeRecipeNutrition` (above) owns the arithmetic; the assertion only ever restated that
 *    a wrapper returned its wrappee.
 *  - "is ABSENT for a recipe with no lines" / "…when every line is unaccountable" / "is PRESENT when at
 *    least one line contributes" — these three encoded the absent-vs-zero rule, and they encoded it WRONGLY
 *    for today's contract: `calories > 0 ? calories : undefined` also erases a MEASURED zero (water, black
 *    coffee) as if it were missing data. The rule now lives in the recipe service's `toRecipeNutritionState`
 *    (`src/recipes/domain/nutritionState.ts`), which decides it from whether any LINE contributed rather
 *    than from the total's value — so a genuine `0` is `known { caloriesPerServing: 0 }` and an unaccounted
 *    recipe is `unaccounted { reason }`. Its coverage is `domain/__tests__/nutritionState.test.ts` and
 *    `recipes/__tests__/recipeNutritionState.test.ts`, and it is strictly stronger than what was deleted.
 */

/**
 * {@link toNutritionLine} is the SINGLE line-assembler every nutrition read routes through — the detail
 * total and the deferred per-recipe batch are built from identical inputs and cannot disagree.
 */
describe('toNutritionLine', () => {
    it('carries only defined fields (absent macro stays absent, never 0)', () => {
        const line = toNutritionLine({ quantity: exact(2), unit: 'g' }, undefined);

        expect(line).toEqual({ quantity: exact(2), unit: 'g' });
    });

    it('merges the measure + user override + catalog per-100g + portions', () => {
        const line = toNutritionLine(
            { quantity: exact(50), unit: 'g', userCalories: 10 },
            { caloriesPer100g: 200, proteinGPer100g: 5, portions: [{ unit: 'cup', gramsPerUnit: 120 }] },
        );

        expect(line).toEqual({
            quantity: exact(50),
            unit: 'g',
            userCalories: 10,
            caloriesPer100g: 200,
            proteinGPer100g: 5,
            portions: [{ unit: 'cup', gramsPerUnit: 120 }],
        });
    });

    // NARROWED, not deleted: this asserted the same composition through `leadCaloriesPerServing`, which is
    // gone. The property it proves is unchanged — an assembled non-mass line is EXCLUDED from the total and
    // flips `isComplete`, rather than silently contributing.
    it('composes with the aggregator: an assembled non-mass line is excluded, not counted', () => {
        const assembled = [
            toNutritionLine({ quantity: exact(100), unit: 'g' }, { caloriesPer100g: 100 }),
            toNutritionLine({ quantity: exact(1), unit: 'clove' }, { caloriesPer100g: 50 }), // non-mass → excluded
        ];

        expect(computeRecipeNutrition(assembled, 1)).toMatchObject({ calories: 100, isComplete: false });
    });
});

describe('hasUserEnteredIngredients', () => {
    it('is false for an empty ingredient list', () => {
        expect(hasUserEnteredIngredients([])).toBe(false);
    });

    it('is false when every ingredient is resolved from the food database', () => {
        expect(
            hasUserEnteredIngredients([
                { ingredientId: 'ing_1', name: 'Olive oil', quantity: exact(2), unit: 'tbsp', isUserEntered: false },
                { ingredientId: 'ing_2', name: 'Garlic', quantity: exact(3), unit: 'clove', isUserEntered: false },
            ]),
        ).toBe(false);
    });

    it('is true when at least one ingredient is user-entered (REQ-032b), even among resolved ones', () => {
        expect(
            hasUserEnteredIngredients([
                { ingredientId: 'ing_1', name: 'Olive oil', quantity: exact(2), unit: 'tbsp', isUserEntered: false },
                {
                    ingredientId: 'ing_2',
                    name: 'Grandma’s spice mix',
                    quantity: exact(1),
                    unit: 'tsp',
                    isUserEntered: true,
                },
            ]),
        ).toBe(true);
    });

    it('is true when every ingredient is user-entered', () => {
        expect(
            hasUserEnteredIngredients([
                {
                    ingredientId: 'ing_1',
                    name: 'Grandma’s spice mix',
                    quantity: exact(1),
                    unit: 'tsp',
                    isUserEntered: true,
                },
            ]),
        ).toBe(true);
    });
});
