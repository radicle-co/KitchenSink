/**
 * THE CLASSIFIER for the deferred-nutrition wire union (plan: deferred calorie lookup) — the single pure
 * rule that turns one recipe's assembled lines into the `known` | `unaccounted` state the wire carries.
 *
 * DESIGN PATTERN: a pure Policy module, the read-side twin of `./visibilityPolicy.ts`. It performs no I/O
 * and knows nothing about HTTP, Drizzle or the food client — it is handed what the batch already fetched
 * and returns the answer, so every branch is directly testable and the service stays orchestration.
 *
 * ## Why the totals alone cannot decide this
 *
 * `computeRecipeNutrition` answers with four numbers and `isComplete`. Three distinctions the deferred
 * contract turns on are invisible in that pair, and each has a wrong-by-default reading:
 *
 *  1. **A genuine `0` versus nothing accounted.** Water and a recipe whose every line failed to resolve
 *     both compute to `calories: 0`. The first is a fact; the second is the absence of one. `known`
 *     REQUIRES a number precisely so an outage can never be reported as "contains no energy", so the split
 *     is decided HERE — by whether any line contributed — rather than by inspecting the number.
 *  2. **Partial versus absent.** `isComplete: false` means "some line could not be accounted for", which is
 *     still a figure worth showing with a caveat. It is NOT `unaccounted`.
 *  3. **WHY there is no figure.** The three reasons are three operational facts with three different fixes:
 *     the author has not resolved their ingredients, food has no qualifying rows for these foods, or food
 *     is unreachable and nothing was cached. A single "no data" would tell the reader nothing actionable.
 *
 * ⚠️ The gateway no longer HAS an `absent` freshness — an id nothing recovered is simply not in its map.
 * What that used to mean
 * with an empty cache, and it lands on `unaccounted{food_unavailable}` — see {@link toRecipeNutritionState}.
 */
import { computeRecipeNutrition, lineNutritionSource, type NutritionLine } from '@kitchensink/recipe-core';

import type { RecipeNutritionState } from '../recipes.schema.js';

/**
 * One recipe's nutrition inputs as the batch produced them: its assembled lines plus how its foods fared in
 * the (shared) lookup.
 *
 * The two counts are what separate `no_resolved_ingredients` / `no_nutrient_data` / `food_unavailable`, and
 * they are PER RECIPE rather than per batch on purpose — a batch-wide verdict would report one recipe's
 * outage as every recipe's.
 */
export interface RecipeNutritionAccounting {
    /** The recipe's lines, already merged with whatever catalog nutrition the lookup produced. */
    readonly lines: readonly NutritionLine[];
    /** Distinct foods the recipe's ingredient rows reference at all. `0` = nothing maps to a food yet. */
    readonly referencedFoodCount: number;
    /** How many of those foods the lookup actually produced an entry for (fresh OR from cache). */
    readonly resolvedFoodCount: number;
    /**
     * How many of THIS recipe's foods came back stale — served from cache after a failed refresh.
     *
     * ⛔ Per recipe, not per batch. Chunks run concurrently under `Promise.allSettled`, so one request can
     * mix fresh and stale ids; caveating a recipe because some OTHER recipe's chunk failed would be a
     * warning about data this reading does not contain.
     */
    readonly staleFoodCount: number;
}

/**
 * Classify one recipe's nutrition into the state the wire carries. Pure.
 *
 * @param accounting - The recipe's assembled lines and its per-recipe food-resolution counts.
 * @param servings - The recipe's serving count (positive; the recipe contract guarantees it).
 * @param degraded - Whether ANY chunk of the shared lookup failed. Used only to tell "food was reachable
 *   and had nothing" from "food could not be reached"; per-recipe staleness comes from
 *   {@link RecipeNutritionAccounting.staleFoodCount}, never from this flag.
 * @returns `known` with a per-serving figure when at least one line contributed, else the reason there is none.
 */
export function toRecipeNutritionState(
    accounting: RecipeNutritionAccounting,
    servings: number,
    degraded: boolean,
): RecipeNutritionState {
    const sources = accounting.lines.map((line) => lineNutritionSource(line));

    if (sources.some((source) => source !== null)) {
        const { calories, proteinG, carbsG, fatG, isComplete } = computeRecipeNutrition(accounting.lines, servings);

        return {
            state: 'known',
            caloriesPerServing: calories,
            proteinG,
            carbsG,
            fatG,
            isComplete,
            // KTD-3b is "serve stale, MARKED" — and equally, do not mark what is not stale. A reading whose
            // accounted lines are all the user's own per-line overrides drew on NO food data, so a food
            // outage cannot have aged it; marking it would be a caveat about data it does not contain.
            freshness: accounting.staleFoodCount > 0 && sources.includes('catalog') ? 'stale' : 'fresh',
        };
    }

    // Nothing contributed. The reason is decided from the recipe's OWN foods, most-specific first.
    if (accounting.referencedFoodCount === 0) {
        // No line maps to a food, so food's availability is irrelevant to this recipe.
        return { state: 'unaccounted', reason: 'no_resolved_ingredients' };
    }

    if (accounting.resolvedFoodCount === 0 && degraded) {
        // The lookup degraded AND recovered nothing for this recipe — including from cache.
        return { state: 'unaccounted', reason: 'food_unavailable' };
    }

    // Food answered. It either has no qualifying per-100g rows for these foods, or the lines' units cannot
    // be converted to a mass — either way the catalog is reachable and the gap is in the data.
    return { state: 'unaccounted', reason: 'no_nutrient_data' };
}
