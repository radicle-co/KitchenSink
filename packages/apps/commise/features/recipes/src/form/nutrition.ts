/**
 * @module @commise/features-recipes/form — projecting the draft's ingredient lines into the recipe-core nutrition aggregator (FR-007/FR-007a).
 *
 * ⛔ Every figure here comes from recipe-core's SINGLE aggregator rather than a second one standing beside
 * it: the per-row calories and the running per-serving total are the same function at different scopes.
 *
 * Pure and platform-agnostic: shared unchanged by the web (`*.tsx`) and native (`*.native.tsx`) form
 * leaves and by the app container, so the two renders can never drift. No React, no platform APIs.
 */
import {
    computeRecipeNutrition,
    toNutritionLine as buildNutritionLine,
    type LineCatalogNutrition,
    type LineMeasure,
    type NutritionLine,
    type RecipeNutrition,
} from '@kitchensink/recipe-core';
import { type RecipeFormIngredient, type RecipeFormValues } from './values.js';
import { draftQuantity } from './quantity.js';

/**
 * Map a form ingredient line to the recipe-core {@link NutritionLine} the aggregator
 * (`computeRecipeNutrition`) consumes (w3/e3 plumbing, feeding step 2's per-row +
 * running per-serving nutrition, FR-007/FR-007a). Delegates the actual merge to recipe-core's own
 * `toNutritionLine(measure, catalog)` — the single place a line's nutrition inputs are combined (module doc,
 * `recipe-core/src/nutrition.ts`) — by splitting this line into its {@link LineMeasure} (quantity/unit + any
 * freeform user override) and its {@link LineCatalogNutrition} (resolved per-100g macros + household
 * portions), omitted entirely when the line carries none of it (still resolving, or a freeform line with no
 * catalog match). A missing `unit` degrades to `''` rather than a guess: the aggregator's own `unitToGrams`
 * cannot convert an empty unit, so the line is correctly excluded (`isComplete: false`) instead of silently
 * assuming a unit. Pure.
 *
 * @param line - The form's ingredient line.
 * @returns The {@link NutritionLine} for the recipe-core nutrition aggregator.
 */
export const toNutritionLine = (line: RecipeFormIngredient): NutritionLine => {
    const measure: LineMeasure = {
        quantity: draftQuantity(line),
        unit: line.unit ?? '',
        ...(line.userCalories === undefined ? {} : { userCalories: line.userCalories }),
        ...(line.userProteinG === undefined ? {} : { userProteinG: line.userProteinG }),
        ...(line.userCarbsG === undefined ? {} : { userCarbsG: line.userCarbsG }),
        ...(line.userFatG === undefined ? {} : { userFatG: line.userFatG }),
    };

    const hasCatalogNutrition =
        line.caloriesPer100g !== undefined ||
        line.proteinGPer100g !== undefined ||
        line.carbsGPer100g !== undefined ||
        line.fatGPer100g !== undefined ||
        line.portions !== undefined;

    const catalog: LineCatalogNutrition | undefined = hasCatalogNutrition
        ? {
              ...(line.caloriesPer100g === undefined ? {} : { caloriesPer100g: line.caloriesPer100g }),
              ...(line.proteinGPer100g === undefined ? {} : { proteinGPer100g: line.proteinGPer100g }),
              ...(line.carbsGPer100g === undefined ? {} : { carbsGPer100g: line.carbsGPer100g }),
              ...(line.fatGPer100g === undefined ? {} : { fatGPer100g: line.fatGPer100g }),
              ...(line.portions === undefined ? {} : { portions: line.portions }),
          }
        : undefined;

    return buildNutritionLine(measure, catalog);
};

/**
 * One ingredient line's own calories (w3/e3, step 2's per-row figure, FR-007) — the SAME aggregator
 * {@link recipeNutritionTotal} uses, run over just this one line at `servings=1` so its per-serving division
 * is a no-op and the result is the line's whole contribution. Returns `undefined` — never a fake `0` — when
 * the line has no computable nutrition: still resolving (no catalog per-100g yet), a freeform line with no
 * user-entered calories, a catalog line whose unit the aggregator cannot convert to grams (no mass factor,
 * no matching portion), or an edit-mode line seeded from `RecipeIngredientView` (which carries no per-100g
 * data at all until the user re-searches it — see `toRecipeFormValues` (`./wire.ts`)). A freeform line's explicit
 * `userCalories: 0` (e.g. water) correctly returns `0`, not `undefined` — the user stated it. Pure.
 *
 * @param line - The form's ingredient line.
 * @returns The line's calories, or `undefined` when it cannot be computed.
 */
export const lineCalories = (line: RecipeFormIngredient): number | undefined => {
    const { calories, isComplete } = computeRecipeNutrition([toNutritionLine(line)], 1);

    return isComplete ? calories : undefined;
};

/**
 * The running per-serving nutrition total for the form's CURRENT ingredient set (w3/e3, step 2's "Total
 * nutrition (per serving)" line, FR-007) — the SAME aggregator {@link lineCalories} uses, run over every
 * line at once at the form's current `servings`. A pure derivation of `values`, not local state: the caller
 * recomputes it on every render, so it stays exact across ingredient add/remove/quantity/unit changes and
 * servings edits, with no risk of a stale cached total. `isComplete` is `false` when any line could not be
 * accounted for; the UI MUST render the honest partial affordance in that case rather than a false-precise
 * number (never hide the exclusion behind a total that looks whole). Pure.
 *
 * @param values - The editor's current form values.
 * @returns The per-serving {@link RecipeNutrition} total.
 */
export const recipeNutritionTotal = (values: RecipeFormValues): RecipeNutrition =>
    computeRecipeNutrition(values.ingredients.map(toNutritionLine), values.servings);
