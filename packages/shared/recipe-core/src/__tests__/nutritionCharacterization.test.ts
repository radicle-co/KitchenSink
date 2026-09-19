/**
 * CHARACTERIZATION of recipe nutrition, pinned BEFORE U10 moves its source (plan U10 execution note).
 *
 * ⚠️ These tests do not assert that the numbers are RIGHT. They assert what the system produces TODAY, so
 * that when nutrition stops coming from `ingredients`' own per-100g columns and starts coming from food's
 * batch endpoint, any change in a user-visible figure is a deliberate, visible diff in this file rather
 * than a silent shift in what someone's recipe says it contains.
 *
 * The two are expected to differ in exactly one direction, and that direction is recorded in the plan's
 * user-visible-consequences table: wherever the OLD substring selector picked a `kJ` energy row, the value
 * changes by ~4.184×. A change anywhere else is a regression, and this file is how it is told apart.
 */
import { describe, it, expect } from 'vitest';

import { statedQuantity, type IngredientQuantity } from '../ingredientQuantity.js';
import { computeRecipeNutrition, toNutritionLine } from '../nutrition.js';

/** A quantity the source stated exactly. */
function exact(value: number): IngredientQuantity {
    const quantity = statedQuantity(value);

    if (quantity === null) {
        throw new Error(`test fixture: ${value} is not a statable amount`);
    }

    return quantity;
}

/** A resolved line: 200 g of a food at 165 kcal/100 g. */
const chicken = toNutritionLine(
    { quantity: exact(200), unit: 'g' },
    { caloriesPer100g: 165, proteinGPer100g: 31, carbsGPer100g: 0, fatGPer100g: 3.6 },
);

/** A volumetric line resolved through a normalized portion: 1 cup at 125 g. */
const flour = toNutritionLine(
    { quantity: exact(1), unit: 'cup' },
    {
        caloriesPer100g: 364,
        proteinGPer100g: 10,
        carbsGPer100g: 76,
        fatGPer100g: 1,
        portions: [{ unit: 'cup', gramsPerUnit: 125 }],
    },
);

/** An unresolved line — no catalog nutrition at all. */
const unresolved = toNutritionLine({ quantity: exact(1), unit: 'pinch' }, undefined);

/** A line whose user override must survive everything U10 does. */
const overridden = toNutritionLine(
    { quantity: exact(1), unit: 'serving', userCalories: 250, userProteinG: 9 },
    { caloriesPer100g: 999, proteinGPer100g: 99, carbsGPer100g: 99, fatGPer100g: 99 },
);

describe('per-line nutrition, as it computes TODAY', () => {
    it('scales a gram line by mass', () => {
        expect(computeRecipeNutrition([chicken], 1)).toMatchObject({
            calories: 330,
            proteinG: 62,
            fatG: 7.2,
        });
    });

    it('resolves a volumetric line through its portion gram weight', () => {
        // 1 cup = 125 g at 364 kcal/100 g = 455 kcal. If U10 broke portion resolution this would fall to
        // zero — silently, because an unconvertible line contributes nothing rather than erroring.
        expect(computeRecipeNutrition([flour], 1).calories).toBe(455);
    });

    it('contributes NOTHING for an unresolved line, rather than zeroing the recipe', () => {
        expect(computeRecipeNutrition([unresolved], 1).calories).toBe(0);
        expect(computeRecipeNutrition([chicken, unresolved], 1).calories).toBe(330);
    });

    it('⛔ prefers a USER OVERRIDE over catalog data — overrides are not food data and U10 must not touch them', () => {
        expect(computeRecipeNutrition([overridden], 1)).toMatchObject({ calories: 250, proteinG: 9 });
    });
});

describe('recipe totals and the per-serving lead figure, as they compute TODAY', () => {
    it('divides the total across servings, ROUNDED to one decimal', () => {
        // 785 / 4 = 196.25, and the system reports 196.3 — it rounds. Pinned as OBSERVED rather than as
        // arithmetic: this is the number a user reads, and U10 must not change it by a hundredth while
        // changing where the inputs come from.
        expect(computeRecipeNutrition([chicken, flour], 4).calories).toBe(196.3);
    });

    /*
     * ⛔ TWO TESTS WERE DELETED HERE, and the reason is that the thing they characterized no longer exists.
     *
     *  - "derives the lead calorie figure from the same inputs as the detail total" asserted that
     *    `leadCaloriesPerServing(lines, n) === computeRecipeNutrition(lines, n).calories`. That equality was
     *    the WHOLE problem: it is the statement that one number had two representations. U10 removed the
     *    stored copy; ADR-0021's follow-up removed the wire copy and the function itself, so there is
     *    nothing left for the two sides of that equation to be.
     *  - "reports the lead figure ABSENT for a recipe with no resolvable nutrition" characterized
     *    `calories > 0 ? calories : undefined`. That rule was replaced — not preserved — by
     *    `toRecipeNutritionState` (recipe service), which separates a MEASURED zero from an unaccounted
     *    recipe instead of conflating them. Its coverage is `domain/__tests__/nutritionState.test.ts`.
     *
     * The characterization this file exists for is unaffected: every user-visible FIGURE below is still
     * pinned against `computeRecipeNutrition`, which is now the only thing that computes one.
     */

    it('treats a partially-resolved recipe as partial, not as zero', () => {
        const partial = computeRecipeNutrition([chicken, unresolved], 2);

        expect(partial.calories).toBe(165);
        expect(partial.calories).toBeGreaterThan(0);
    });
});
