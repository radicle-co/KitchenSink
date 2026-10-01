/**
 * @module @commise/features-recipes/form — projecting the draft's ingredient lines into the recipe-core nutrition
 * aggregator (FR-007/FR-007a).
 *
 * ⛔ Every figure here comes from recipe-core's SINGLE aggregator rather than a second one standing beside it. The
 * catalog figures come from the editor's one background read (`./nutritionLookup.ts`); the draft carries only the
 * line's food ref and whatever figures the cook stated (plan 002 V1, blueprint Decision 3).
 *
 * Pure and platform-agnostic: shared unchanged by the web (`*.tsx`) and native (`*.native.tsx`) form leaves and by
 * the app container, so the two renders can never drift. No React, no platform APIs.
 */
import {
    computeRecipeNutrition,
    lineNutritionSource,
    toNutritionLine as buildNutritionLine,
    type LineCatalogNutrition,
    type LineMeasure,
    type NutritionLine,
    type RecipeNutrition,
} from '@kitchensink/recipe-core';

import { isCatalogWithheld, type LineNutritionLookup } from './nutritionLookup.js';
import { draftQuantity } from './quantity.js';
import { type RecipeFormIngredient, type RecipeFormValues } from './values.js';

/** A line's macros, whichever source states them. An absent figure is unknown, never 0. */
export interface LineFigures {
    readonly calories?: number;
    readonly proteinG?: number;
    readonly carbsG?: number;
    readonly fatG?: number;
}

/**
 * The line's catalog figures from the editor's nutrition read, or `undefined` when it has no food ref, its catalog
 * figures are withheld ({@link isCatalogWithheld} — the detail read withholds them too), or the read has not answered
 * with figures for it. Pure.
 *
 * @param line - The draft line.
 * @param lookup - The editor's nutrition lookup.
 * @returns The catalog figures, or `undefined`.
 */
export const lineCatalogOf = (
    line: RecipeFormIngredient,
    lookup: LineNutritionLookup,
): LineCatalogNutrition | undefined => {
    if (line.foodRef === undefined || isCatalogWithheld(line)) {
        return undefined;
    }

    const entry = lookup(line.foodRef);

    return entry.state === 'found' ? entry.catalog : undefined;
};

/**
 * The figures the cook stated for this line, when — and only when — the aggregator counts THEM rather than the
 * catalog's; `undefined` otherwise.
 *
 * ⛔ The question "whose figures count?" is recipe-core's (`lineNutritionSource`), not answered again here: §6b
 * requires the panel to agree with the total, and the aggregator counts the cook's figures only when they state the
 * calories. A stated protein alone does not make the line the cook's (staff-architect REVIEW F2). Pure.
 *
 * @param line - The draft line.
 * @param catalog - Its catalog figures, from {@link lineCatalogOf}.
 * @returns The stated figures (an honest `0` kept), or `undefined`.
 */
export const userStatedFiguresOf = (
    line: RecipeFormIngredient,
    catalog?: LineCatalogNutrition,
): LineFigures | undefined => {
    if (lineNutritionSource(toNutritionLine(line, catalog)) !== 'user') {
        return undefined;
    }

    return {
        ...(line.userCalories === undefined ? {} : { calories: line.userCalories }),
        ...(line.userProteinG === undefined ? {} : { proteinG: line.userProteinG }),
        ...(line.userCarbsG === undefined ? {} : { carbsG: line.userCarbsG }),
        ...(line.userFatG === undefined ? {} : { fatG: line.userFatG }),
    };
};

/**
 * Map a draft line to the recipe-core {@link NutritionLine}, through recipe-core's own `toNutritionLine` — the single
 * place a line's measure and figures are combined. A missing `unit` degrades to `''`, which the aggregator cannot
 * convert, so the line is honestly excluded rather than given a guessed unit. Pure.
 *
 * @param line - The draft line.
 * @param catalog - Its catalog figures, from {@link lineCatalogOf}.
 * @returns The aggregator's line.
 */
export const toNutritionLine = (line: RecipeFormIngredient, catalog?: LineCatalogNutrition): NutritionLine => {
    const measure: LineMeasure = {
        quantity: draftQuantity(line),
        unit: line.unit ?? '',
        ...(line.userCalories === undefined ? {} : { userCalories: line.userCalories }),
        ...(line.userProteinG === undefined ? {} : { userProteinG: line.userProteinG }),
        ...(line.userCarbsG === undefined ? {} : { userCarbsG: line.userCarbsG }),
        ...(line.userFatG === undefined ? {} : { userFatG: line.userFatG }),
    };

    return buildNutritionLine(measure, catalog);
};

/**
 * The running per-serving total for the draft's CURRENT lines, from recipe-core's one aggregator fed by the editor's
 * nutrition lookup. `isComplete` is `false` while any line cannot be accounted for — still loading, failed, or no
 * convertible unit — and the UI must then say so rather than show a total that looks whole. Pure.
 *
 * @param values - The editor's draft.
 * @param lookup - The editor's nutrition lookup.
 * @returns The per-serving {@link RecipeNutrition}.
 */
export const recipeNutritionTotal = (values: RecipeFormValues, lookup: LineNutritionLookup): RecipeNutrition =>
    computeRecipeNutrition(
        values.ingredients.map((line) => toNutritionLine(line, lineCatalogOf(line, lookup))),
        values.servings,
    );
