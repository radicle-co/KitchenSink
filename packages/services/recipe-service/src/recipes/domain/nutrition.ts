/**
 * Per-serving recipe nutrition aggregation (FR-007 / FR-007a). Pure — no I/O.
 *
 * Each ingredient line contributes its macros in one of two ways, in priority order:
 *   1. **User-entered override** (FR-007a) — an absolute, per-line value the user typed for a freeform
 *      ingredient. When a line carries `userCalories`, its user values are authoritative (any macro the
 *      user left blank counts as 0).
 *   2. **Food-database per-100g** — the resolved catalog nutrition, scaled by the line's mass. This
 *      requires a MASS unit (g/kg/mg/oz/lb) so the quantity can be converted to grams; a volumetric or
 *      count unit (cup/tbsp/clove/…) has no known gram weight here and so cannot be scaled.
 *
 * A line the aggregator cannot account for — a food still resolving (no per-100g yet), a freeform line
 * with no user nutrition, or a catalog line in a non-mass unit — is EXCLUDED from the sum and flips
 * `isComplete` to `false`, so the UI presents the total as a partial estimate rather than a false-precise
 * number. (Full coverage of volumetric/count units needs household-measure gram weights persisted per
 * ingredient — the food service exposes them (`PortionView.gramWeight`) but 001 does not yet store them;
 * see the nutrition follow-up.)
 */
import type { RecipeNutrition } from '@kitchensink/recipe-core';

/** One ingredient line's nutrition inputs: its measure, any user override, and the catalog per-100g values. */
export interface NutritionLine {
    readonly quantity: number;
    readonly unit: string;
    readonly userCalories?: number;
    readonly userProteinG?: number;
    readonly userCarbsG?: number;
    readonly userFatG?: number;
    readonly caloriesPer100g?: number;
    readonly proteinGPer100g?: number;
    readonly carbsGPer100g?: number;
    readonly fatGPer100g?: number;
}

/** Grams per one unit, for the mass units whose conversion is exact and ingredient-independent. */
const MASS_UNIT_TO_GRAMS: Readonly<Record<string, number>> = {
    g: 1,
    gram: 1,
    grams: 1,
    kg: 1000,
    kilogram: 1000,
    kilograms: 1000,
    mg: 0.001,
    oz: 28.3495,
    ounce: 28.3495,
    ounces: 28.3495,
    lb: 453.592,
    lbs: 453.592,
    pound: 453.592,
    pounds: 453.592,
};

/** The absolute macro contribution of one line, or `null` when it cannot be accounted for. */
interface Macros {
    readonly calories: number;
    readonly proteinG: number;
    readonly carbsG: number;
    readonly fatG: number;
}

/** Convert a quantity in `unit` to grams, or `null` when `unit` is not a known mass unit. Pure. */
function massInGrams(quantity: number, unit: string): number | null {
    const factor = MASS_UNIT_TO_GRAMS[unit.trim().toLowerCase()];

    return factor === undefined ? null : quantity * factor;
}

/** The macro contribution of a single line (user override first, else scaled per-100g), or `null`. Pure. */
function lineMacros(line: NutritionLine): Macros | null {
    if (line.userCalories !== undefined) {
        return {
            calories: line.userCalories,
            proteinG: line.userProteinG ?? 0,
            carbsG: line.userCarbsG ?? 0,
            fatG: line.userFatG ?? 0,
        };
    }

    if (line.caloriesPer100g !== undefined) {
        const grams = massInGrams(line.quantity, line.unit);

        if (grams === null) {
            return null; // catalog nutrition, but a non-mass unit we can't convert to grams
        }

        const factor = grams / 100;

        return {
            calories: line.caloriesPer100g * factor,
            proteinG: (line.proteinGPer100g ?? 0) * factor,
            carbsG: (line.carbsGPer100g ?? 0) * factor,
            fatG: (line.fatGPer100g ?? 0) * factor,
        };
    }

    return null; // no user override and no resolved catalog nutrition
}

/** Round to one decimal place (nutrition wire precision). Pure. */
function round1(value: number): number {
    return Math.round(value * 10) / 10;
}

/**
 * Aggregate the per-serving {@link RecipeNutrition} for a recipe's ingredient lines.
 *
 * @param lines - The recipe's ingredient lines with their measures + nutrition inputs.
 * @param servings - The recipe's serving count (REQUIRED positive — the recipe contract guarantees it).
 * @returns Per-serving calories/protein/carbs/fat, and `isComplete=false` if any line was unaccounted.
 */
export function computeRecipeNutrition(lines: readonly NutritionLine[], servings: number): RecipeNutrition {
    let calories = 0;
    let proteinG = 0;
    let carbsG = 0;
    let fatG = 0;
    let isComplete = true;

    for (const line of lines) {
        const macros = lineMacros(line);

        if (macros === null) {
            isComplete = false;
            continue;
        }

        calories += macros.calories;
        proteinG += macros.proteinG;
        carbsG += macros.carbsG;
        fatG += macros.fatG;
    }

    return {
        calories: round1(calories / servings),
        proteinG: round1(proteinG / servings),
        carbsG: round1(carbsG / servings),
        fatG: round1(fatG / servings),
        isComplete,
    };
}
