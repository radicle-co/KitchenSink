/**
 * @module @commise/features-recipes/nutrition — the CLIENT-side model for the deferred calorie lookup.
 *
 * A recipe's per-serving energy is a THREE-state fact, and this module is where the third state lives.
 * `known` and `unaccounted` are the two the WIRE carries ({@link RecipeNutritionState}); `pending` exists
 * ONLY here, as the condition of a promise that has not settled — and its absence from the wire is the
 * enforcement, not an omission: the moment a server can say "pending", a skeleton can become permanent,
 * because a spinner rendering forever is exactly what an origin saying "still working" produces when nothing
 * ever contradicts it. `unaccounted` is terminal by contrast; it is the ANSWER, not the absence of one.
 *
 * **Design pattern: discriminated union + exhaustive switch (Visitor, satisfied by the language).** Each leaf
 * renders the RESOLVED union with an exhaustive `switch` rather than re-deriving the state from raw flags —
 * the same shape `IngredientResolverViewState` uses. `pending` is deliberately NOT in the union the chip
 * switches over: it is the Suspense fallback, a DIFFERENT component, which is what makes a permanent skeleton
 * unrepresentable rather than merely discouraged.
 *
 * ⛔ NOTHING HERE RE-DECLARES A WIRE SHAPE (§15 / ADR-0014). The two settled members are DERIVED from
 * `@kitchensink/schema-recipe`'s `RecipeNutritionState` with `Extract` + `Pick`, so a field added to,
 * removed from, or renamed on the wire is a COMPILE error here rather than a silent divergence.
 *
 * ⚠️ ONE DISCRIMINANT, and it is the wire's. The client union adds `{ state: 'pending' }` — spelled `state`,
 * not `kind`, even though `kind` is this codebase's usual discriminant for a client view union. Re-keying the
 * settled members onto `kind` would mean rebuilding them field by field, which IS re-declaring a wire shape;
 * keeping the wire's discriminant lets the resolved union be the wire union EXACTLY, with the pending member
 * added on top and removable again by `Exclude`.
 */
import type { Locale } from '@commise/i18n';
import type { RecipeNutritionResponse, RecipeNutritionState } from '@kitchensink/schema-recipe';

import { formatCalories } from '../card/model.js';
import { fillTemplate } from '../list/model.js';
import type { RecipeNutritionMessages } from './messages.js';

/**
 * A settled reading WITH a figure, narrowed to the four fields a calorie chip actually reads.
 *
 * DERIVED, never declared: `Extract` selects the wire's `known` member and `Pick` states this consumer's
 * genuinely narrower interest in it (ADR-0014's "a consumer whose shape differs DERIVES it"). The macro
 * fields (`proteinG`/`carbsG`/`fatG`) belong to the detail surface, not to a card chip, so widening them into
 * this type would make the chip depend on data it never renders.
 *
 * `caloriesPerServing` is REQUIRED, and a zero here is a measured zero — water and black coffee genuinely
 * have none. Every failure path lands in {@link RecipeCalorieUnaccounted} instead, which carries no figure
 * for a leaf to render by accident.
 */
export type RecipeCalorieReading = Pick<
    Extract<RecipeNutritionState, { state: 'known' }>,
    'state' | 'caloriesPerServing' | 'isComplete' | 'freshness'
>;

/** A settled reading with NO figure, and the reason why — the wire member verbatim. */
export type RecipeCalorieUnaccounted = Extract<RecipeNutritionState, { state: 'unaccounted' }>;

/** Why a settled reading carries no figure. */
export type RecipeCalorieUnaccountedReason = RecipeCalorieUnaccounted['reason'];

/**
 * The RESOLVED union — every state a settled lookup can be in, and the only union a render component
 * switches over. A component typed against this one structurally CANNOT render a pending state.
 */
export type RecipeCalorieState = RecipeCalorieReading | RecipeCalorieUnaccounted;

/** The client-only in-flight state: the condition of an unsettled promise, and never a wire value. */
export interface RecipeCaloriePending {
    readonly state: 'pending';
}

/**
 * The full client view state space: the settled answers plus the in-flight condition.
 *
 * Composed so that `Exclude<RecipeNutritionViewState, RecipeCaloriePending>` is EXACTLY
 * {@link RecipeCalorieState} by construction — the boundary between "what Suspense renders as a fallback"
 * and "what a render component may switch over" is a type relation, not a convention.
 */
export type RecipeNutritionViewState = RecipeCaloriePending | RecipeCalorieState;

/**
 * The answer for a lookup that FAILED. Named once, because a failed lookup is a terminal `unaccounted`
 * answer — never a retry-forever skeleton — and the error boundary and its tests must agree on which.
 *
 * ⛔ NOT the answer for a recipe the response OMITTED. The wire contract is explicit that a recipe the caller
 * may not read is absent from the map, and that _"clients must treat a missing key as 'not for you', not as
 * an error"_ — so an omitted recipe is neither `known` nor `unaccounted`, and this state space deliberately
 * does not encode it. It is the HOST's decision, and the answer this module recommends is to render no
 * nutrition slot at all for such a recipe (absence of a figure, not a claim about one).
 *
 * Reaching for this constant instead would be invisible today (both render nothing on a card) and become a
 * LIE the moment the detail disclosure ships: "Nutrition is unavailable right now. Try again shortly." about
 * a recipe the viewer is simply not permitted to read.
 *
 * ✅ SETTLED (owner ruling, 2026-08-16): an omitted recipe shows the skeleton while the lookup is in flight
 * and then renders NOTHING. That answer is implemented by {@link selectRecipeCalorieState}, which returns
 * `null` for it — a value a host must branch on rather than a hole that flows onward. Use that; do not reach
 * for this constant, and do not encode omission as a member of the state space.
 */
export const NUTRITION_FOOD_UNAVAILABLE: RecipeCalorieUnaccounted = {
    state: 'unaccounted',
    reason: 'food_unavailable',
};

/**
 * Select ONE recipe's settled calorie state out of the batch response, or `null` when the response OMITTED
 * that recipe. Pure, and TOTAL over every id a caller can ask about.
 *
 * ⛔ THE `null` IS THE POINT, and it settles the question flagged at {@link NUTRITION_FOOD_UNAVAILABLE}.
 * OWNER RULING (2026-08-16): an omitted recipe renders NOTHING where the figure would be — it is neither
 * `known` nor `unaccounted`, because the response says nothing about it and food was never the reason. So the
 * absence is returned as a value a host must BRANCH on, and `null` is deliberately not assignable to
 * `RecipeNutritionBoundary`'s promise: a host that ignores it does not compile.
 *
 * Without this, a host indexes `response.nutrition[id]` directly and gets `undefined` with NO compile error —
 * this repo does not enable `noUncheckedIndexedAccess`, so the index types as a `RecipeNutritionState` that
 * simply is not there. From there the three ways to be wrong all look reasonable in review: pass `undefined`
 * into the chip's exhaustive switch, mount the boundary with no promise to settle (**a skeleton that renders
 * forever** — the exact failure this design exists to make unrepresentable), or substitute
 * `NUTRITION_FOOD_UNAVAILABLE` and tell the viewer about an outage that did not happen.
 *
 * `Object.hasOwn`, not a truthiness check or a bare index: a `Record` index reaches the prototype chain, so a
 * recipe id colliding with an `Object.prototype` member would otherwise yield a FUNCTION where a state
 * belongs.
 *
 * @param response - The batch response for the recipes this surface asked about.
 * @param recipeId - The recipe whose figure this slot renders.
 * @returns The settled state, or `null` when the response omitted this recipe (render no figure at all).
 */
export const selectRecipeCalorieState = (
    response: RecipeNutritionResponse,
    recipeId: string,
): RecipeCalorieState | null =>
    Object.hasOwn(response.nutrition, recipeId) ? (response.nutrition[recipeId] ?? null) : null;

/** What a leaf needs to paint one calorie chip: the two strings, plus the two flags that style it. */
export interface RecipeCalorieChipModel {
    /** The visible chip text, e.g. `"420 cal"` or, for an incomplete reading, `"~420 cal"`. */
    readonly text: string;
    /**
     * The chip's accessible name. Equals {@link text} for a complete, fresh reading; otherwise it is the
     * whole-sentence template carrying the caveat, so the qualification reaches a screen-reader user and not
     * only a sighted one.
     */
    readonly label: string;
    /** The figure came from cache during a food outage — "serve stale, MARKED" (KTD-3b). */
    readonly isStale: boolean;
    /** Some ingredient line could not be accounted for, so the figure is a floor, not a total. */
    readonly isApproximate: boolean;
}

/**
 * Project a settled calorie READING into the strings and flags a chip renders. Pure.
 *
 * The number is formatted by the card's own {@link formatCalories} (locale-grouped via `Intl.NumberFormat`,
 * never concatenation), so the deferred figure and any figure the card already renders agree digit for digit.
 * A zero is formatted like any other number — the state, not the value, is what says "we have no figure".
 *
 * @param reading - The settled reading carrying a figure.
 * @param locale - The active BCP-47 locale.
 * @param messages - The resolved nutrition copy for that locale.
 * @returns The chip's visible text, accessible name and presentation flags.
 */
export const toCalorieChipModel = (
    reading: RecipeCalorieReading,
    locale: Locale,
    messages: RecipeNutritionMessages,
): RecipeCalorieChipModel => {
    const isStale = reading.freshness === 'stale';
    const isApproximate = !reading.isComplete;
    const calories = formatCalories(reading.caloriesPerServing, locale);
    const labelTemplate = isApproximate
        ? isStale
            ? messages.caloriesApproximateStaleLabel
            : messages.caloriesApproximateLabel
        : isStale
          ? messages.caloriesStaleLabel
          : messages.calories;

    return {
        text: fillTemplate(isApproximate ? messages.caloriesApproximate : messages.calories, { calories }),
        label: fillTemplate(labelTemplate, { calories }),
        isStale,
        isApproximate,
    };
};

/**
 * The localized explanation for an `unaccounted` reading. Total over the wire enum — a new reason is a
 * COMPILE error here, never a blank disclosure. Pure.
 *
 * A card renders NOTHING for an unaccounted reading (the established absent-value rule), so this copy is for
 * the DETAIL surface's disclosure, where a reader who came looking for the figure is owed the reason.
 *
 * @param reason - Why the settled reading carries no figure.
 * @param messages - The resolved nutrition copy for the active locale.
 * @returns The localized sentence explaining the absence.
 */
export const unaccountedReasonText = (
    reason: RecipeCalorieUnaccountedReason,
    messages: RecipeNutritionMessages,
): string => {
    switch (reason) {
        case 'no_resolved_ingredients':
            return messages.unaccountedNoResolvedIngredients;
        case 'no_nutrient_data':
            return messages.unaccountedNoNutrientData;
        case 'food_unavailable':
            return messages.unaccountedFoodUnavailable;
    }
};
