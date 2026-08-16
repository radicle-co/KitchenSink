/**
 * ⛔ THE CLASSIFIER for the deferred-nutrition union — the pure rule that decides `known` vs each of the
 * three `unaccounted` reasons, and whether a `known` reading is `fresh` or `stale`.
 *
 * The union's own invariants are pinned by `../../__tests__/recipeNutritionState.test.ts` (what the WIRE
 * may carry). This file pins the half that schema cannot express: WHICH member a given recipe earns. Every
 * case below is one the aggregate totals cannot decide on their own —
 *
 *  - a recipe that genuinely sums to `0` and a recipe nothing could be accounted for BOTH report
 *    `calories: 0`, and they are opposite answers;
 *  - `isComplete: false` does not mean `unaccounted` — one accounted line among several unaccountable ones
 *    is still a figure, reported as incomplete;
 *  - the three `unaccounted` reasons are three different operational facts with three different fixes
 *    ("resolve your ingredients", "food has no data for these", "food is down"), and collapsing them would
 *    tell the reader nothing actionable.
 */
import { describe, expect, it } from 'vitest';

import type { NutritionLine } from '@kitchensink/recipe-core';

import { toRecipeNutritionState } from '../nutritionState.js';

/** A catalog line that accounts cleanly: 200 g at 350 kcal/100 g → 700 kcal. */
const catalogLine: NutritionLine = {
    quantity: 200,
    unit: 'g',
    caloriesPer100g: 350,
    proteinGPer100g: 12,
    carbsGPer100g: 70,
    fatGPer100g: 2,
};

/** A line the user priced themselves — accounted WITHOUT any food data. */
const userLine: NutritionLine = { quantity: 1, unit: 'scoop', userCalories: 200, userProteinG: 30 };

/** A line nothing can account for: no override, no catalog nutrition. */
const unaccountableLine: NutritionLine = { quantity: 1, unit: 'pinch' };

describe('toRecipeNutritionState — known', () => {
    it('reports the per-serving figure, marked complete and fresh', () => {
        const state = toRecipeNutritionState(
            { lines: [catalogLine], referencedFoodCount: 1, resolvedFoodCount: 1, staleFoodCount: 0 },
            2,
            false,
        );

        expect(state).toStrictEqual({
            state: 'known',
            caloriesPerServing: 350,
            proteinG: 12,
            carbsG: 70,
            fatG: 2,
            isComplete: true,
            freshness: 'fresh',
        });
    });

    it('⛔ reports a GENUINE measured zero as known, never as unaccounted', () => {
        // Water, black coffee, a zero-calorie sweetener. The line IS accounted; its contribution is 0. This
        // is the exact case the union's `known`-requires-a-number rule exists to keep renderable.
        const water: NutritionLine = { quantity: 250, unit: 'g', caloriesPer100g: 0 };

        expect(
            toRecipeNutritionState(
                { lines: [water], referencedFoodCount: 1, resolvedFoodCount: 1, staleFoodCount: 0 },
                1,
                false,
            ),
        ).toStrictEqual({
            state: 'known',
            caloriesPerServing: 0,
            proteinG: 0,
            carbsG: 0,
            fatG: 0,
            isComplete: true,
            freshness: 'fresh',
        });
    });

    it('⛔ stays known when SOME lines are unaccountable — that is `isComplete: false`, not `unaccounted`', () => {
        const state = toRecipeNutritionState(
            {
                lines: [catalogLine, unaccountableLine],
                referencedFoodCount: 1,
                resolvedFoodCount: 1,
                staleFoodCount: 0,
            },
            2,
            false,
        );

        expect(state).toMatchObject({ state: 'known', caloriesPerServing: 350, isComplete: false });
    });

    it('⛔ marks a reading STALE when THIS recipe`s own food came from cache (KTD-3b)', () => {
        // `staleFoodCount`, not the batch-level `degraded` flag. Chunks run concurrently under
        // `Promise.allSettled`, so one request mixes fresh and stale ids — and a recipe whose own foods
        // all came back fresh must not be caveated because a sibling recipe's chunk failed.
        const state = toRecipeNutritionState(
            { lines: [catalogLine], referencedFoodCount: 1, resolvedFoodCount: 1, staleFoodCount: 1 },
            2,
            true,
        );

        expect(state).toMatchObject({ state: 'known', freshness: 'stale' });
    });

    it('⛔ does NOT mark a user-priced recipe stale during a food outage — it drew on no food data', () => {
        // The contamination this rule prevents: recipe A is priced entirely by the user, recipe B's food
        // lookup failed, and they share one batch. Marking A "may be out of date" is a caveat about data A
        // does not contain.
        const state = toRecipeNutritionState(
            { lines: [userLine], referencedFoodCount: 0, resolvedFoodCount: 0, staleFoodCount: 0 },
            1,
            true,
        );

        expect(state).toMatchObject({ state: 'known', caloriesPerServing: 200, freshness: 'fresh' });
    });

    it('⛔ a user override beats catalog nutrition, so the reading stays fresh under degradation', () => {
        const overridden: NutritionLine = { ...catalogLine, userCalories: 50 };
        const state = toRecipeNutritionState(
            { lines: [overridden], referencedFoodCount: 1, resolvedFoodCount: 1, staleFoodCount: 0 },
            1,
            true,
        );

        expect(state).toMatchObject({ state: 'known', caloriesPerServing: 50, freshness: 'fresh' });
    });
});

describe('toRecipeNutritionState — unaccounted', () => {
    it('reports `no_resolved_ingredients` when nothing maps to a food yet', () => {
        expect(
            toRecipeNutritionState(
                { lines: [unaccountableLine], referencedFoodCount: 0, resolvedFoodCount: 0, staleFoodCount: 0 },
                4,
                false,
            ),
        ).toStrictEqual({ state: 'unaccounted', reason: 'no_resolved_ingredients' });
    });

    it('reports `no_resolved_ingredients` for a recipe with no ingredient lines at all', () => {
        expect(
            toRecipeNutritionState(
                { lines: [], referencedFoodCount: 0, resolvedFoodCount: 0, staleFoodCount: 0 },
                4,
                false,
            ),
        ).toStrictEqual({ state: 'unaccounted', reason: 'no_resolved_ingredients' });
    });

    it('⛔ still reports `no_resolved_ingredients` during a food OUTAGE when the recipe references no food', () => {
        // The precedence between the two reasons, which a mutation survived until this case existed. A
        // recipe whose lines map to no food at all is unaffected by food being down — telling its author
        // "food is unavailable" points them at an outage they cannot act on, when the actual fix is to
        // resolve their ingredients. Food's availability is only relevant to a recipe that needs food.
        expect(
            toRecipeNutritionState(
                { lines: [unaccountableLine], referencedFoodCount: 0, resolvedFoodCount: 0, staleFoodCount: 0 },
                4,
                true,
            ),
        ).toStrictEqual({ state: 'unaccounted', reason: 'no_resolved_ingredients' });
    });

    it('reports `no_nutrient_data` when food ANSWERED but carries no qualifying per-100g rows', () => {
        // Food is up (`fresh`) and knows the food; it simply has no per-100g energy row for it. That is a
        // data gap in the catalog, not an outage, and the two need different responses.
        expect(
            toRecipeNutritionState(
                { lines: [unaccountableLine], referencedFoodCount: 1, resolvedFoodCount: 1, staleFoodCount: 0 },
                4,
                false,
            ),
        ).toStrictEqual({ state: 'unaccounted', reason: 'no_nutrient_data' });
    });

    it('⛔ reports `no_nutrient_data`, not `food_unavailable`, when food answered and knows none of the ids', () => {
        expect(
            toRecipeNutritionState(
                { lines: [unaccountableLine], referencedFoodCount: 2, resolvedFoodCount: 0, staleFoodCount: 0 },
                4,
                false,
            ),
        ).toStrictEqual({ state: 'unaccounted', reason: 'no_nutrient_data' });
    });

    it('⛔ reports `food_unavailable` when the lookup failed with nothing cached for this recipe', () => {
        // The gateway's third freshness value, `absent`, is NOT a wire freshness — it lands HERE.
        expect(
            toRecipeNutritionState(
                { lines: [unaccountableLine], referencedFoodCount: 1, resolvedFoodCount: 0, staleFoodCount: 0 },
                4,
                true,
            ),
        ).toStrictEqual({ state: 'unaccounted', reason: 'food_unavailable' });
    });

    it('reports `food_unavailable` when the batch degraded and THIS recipe recovered nothing from cache', () => {
        // A partially-warm cache: other recipes were served stale, this one has nothing.
        expect(
            toRecipeNutritionState(
                { lines: [unaccountableLine], referencedFoodCount: 1, resolvedFoodCount: 0, staleFoodCount: 0 },
                4,
                true,
            ),
        ).toStrictEqual({ state: 'unaccounted', reason: 'food_unavailable' });
    });

    it('⛔ NEVER carries a figure — an outage must leave nothing for a client to render as 0', () => {
        const state = toRecipeNutritionState(
            { lines: [unaccountableLine], referencedFoodCount: 1, resolvedFoodCount: 0, staleFoodCount: 0 },
            4,
            true,
        );

        expect(Object.keys(state).sort()).toStrictEqual(['reason', 'state']);
    });
});
