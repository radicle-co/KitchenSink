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
 *  3. **WHY there is no figure.** The four reasons are four operational facts with four different fixes:
 *     the author has not resolved their ingredients, food has no qualifying rows for these foods, food is
 *     unreachable and nothing was cached, or the U11 verification gate contradicted the line and we WITHHELD
 *     a figure the catalog was perfectly able to supply. A single "no data" would tell the reader nothing
 *     actionable — and the fourth in particular must never collapse into the third, because an outage says
 *     "come back later" about an answer a retry will not change.
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
    /**
     * How many of this recipe's lines the U11 verification gate CONTRADICTED **and** whose catalog nutrition
     * would otherwise have been accounted for (plan U14 / R15).
     *
     * ⛔ REQUIRED, not optional, and that is the lesson `rangeDerivedBound` taught this file the hard way: an
     * optional field on a positively-enumerated struct is dropped at a call site with no compile error, and
     * the resulting silence looks exactly like "nothing was withheld". A caller that has not thought about
     * withholding must say `0` out loud.
     *
     * ⚠️ "WOULD OTHERWISE HAVE BEEN ACCOUNTED FOR" is load-bearing. A contradicted line that carried no
     * usable nutrition anyway (no per-100g rows, or a unit with no mass) did not cost this recipe its figure,
     * so counting it would blame the gate for an absence it did not cause.
     */
    readonly withheldLineCount: number;
    /**
     * How many of this recipe's lines are WITHHELD as KTD-A `pending-verification` (plan U4c) **and**
     * would otherwise have been accounted for.
     *
     * ⛔ REQUIRED, for `withheldLineCount`'s reason exactly: an optional count silently dropped at a call
     * site reads as "nothing is pending".
     */
    readonly pendingLineCount: number;
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
        // ⛔ `rangeDerivedBound` is destructured and forwarded DELIBERATELY. It was omitted here, and because
        // this is a positive enumeration rather than a spread, dropping it cost no compile error — the
        // batch that feeds every recipe card published a figure that can sit up to a third under the stated
        // range with no caveat, while the detail view disclosed it (R38).
        const { calories, proteinG, carbsG, fatG, isComplete, rangeDerivedBound } = computeRecipeNutrition(
            accounting.lines,
            servings,
        );

        return {
            state: 'known',
            caloriesPerServing: calories,
            proteinG,
            carbsG,
            fatG,
            isComplete,
            ...(rangeDerivedBound === undefined ? {} : { rangeDerivedBound }),
            // KTD-3b is "serve stale, MARKED" — and equally, do not mark what is not stale. A reading whose
            // accounted lines are all the user's own per-line overrides drew on NO food data, so a food
            // outage cannot have aged it; marking it would be a caveat about data it does not contain.
            freshness: accounting.staleFoodCount > 0 && sources.includes('catalog') ? 'stale' : 'fresh',
        };
    }

    // Nothing contributed. The reason is decided from the recipe's OWN foods, most-specific first.
    if (accounting.withheldLineCount > 0) {
        // ⛔ FIRST, and ahead of every food-side reason. `withheldLineCount` already means "a line the gate
        // contradicted that WOULD otherwise have accounted", so reaching this branch means our own doubt is
        // the proximate cause of there being no figure — the food service answered, the catalog had the data,
        // and we declined to publish it. The remaining lines' silence is not new information; the withholding
        // is. See `RecipeNutritionAccounting.withheldLineCount`.
        return { state: 'unaccounted', reason: 'verification_disagreement' };
    }

    if (accounting.pendingLineCount > 0) {
        // KTD-A (plan U4c), SECOND after disagreement: the figure is absent because we have not finished
        // CHECKING — the verdicts are in flight and the total re-flows as they land. Softer than
        // `verification_disagreement` (which says we checked and disagreed), stronger than the food-side
        // reasons (the catalog answered; the withholding is ours).
        return { state: 'unaccounted', reason: 'verification_pending' };
    }

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
