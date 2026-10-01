/**
 * @module @commise/features-recipes/form — every sub-state of an ingredient row's nutrition panel
 * (`docs/design/ingredientStatusExplanation.md` §6b, SPECIFY.4).
 *
 * ⛔ It never answers "does this line have nutrition?" itself: the cook's figures come from `userStatedFiguresOf` and
 * the catalog's from `lineCatalogOf` (`./nutrition.ts`), the same two the total reads, so the panel and the total
 * cannot contradict each other on one row.
 *
 * Pure and platform-agnostic.
 *
 * @pattern Specification — the panel's sub-state as a function of the line and the lookup
 */
import type { RowFigures } from './ingredientRowPolicy.js';
import { lineCatalogOf, userStatedFiguresOf, type LineFigures } from './nutrition.js';
import type { LineNutritionLookup } from './nutritionLookup.js';
import type { RecipeFormIngredient } from './values.js';

/** What the panel shows. */
export type NutritionPanelState =
    /** The cook stated figures for this line: they are authoritative, and they are what the total used. */
    | { readonly kind: 'userStated'; readonly figures: LineFigures }
    /** The editor's read has not answered for this food yet. */
    | { readonly kind: 'loading' }
    /** The read failed, or food could not be asked. Distinct from "no figures", which is an answer. */
    | { readonly kind: 'failed' }
    /** There is nothing to read: no food ref, or food answered with nothing this cook may read. */
    | { readonly kind: 'noData' }
    /** Food answered and publishes no figures for this food. */
    | { readonly kind: 'noFigures' }
    /** Food's figures per 100 g; `partial` when at least one is not published. */
    | { readonly kind: 'figures'; readonly figures: LineFigures; readonly partial: boolean };

/**
 * A row's nutrition panel state. Pure.
 *
 * @param line - The draft line.
 * @param lookup - The editor's nutrition lookup.
 * @returns The panel's sub-state.
 */
export const nutritionPanelOf = (line: RecipeFormIngredient, lookup: LineNutritionLookup): NutritionPanelState => {
    const stated = userStatedFiguresOf(line, lineCatalogOf(line, lookup));

    if (stated !== undefined) {
        return { kind: 'userStated', figures: stated };
    }

    if (line.foodRef === undefined) {
        return { kind: 'noData' };
    }

    const entry = lookup(line.foodRef);

    switch (entry.state) {
        case 'pending':
            return { kind: 'loading' };
        case 'failed':
        case 'unavailable':
            return { kind: 'failed' };
        case 'absent':
            return { kind: 'noData' };

        case 'found': {
            const { catalog } = entry;
            const figures: LineFigures = {
                ...(catalog.caloriesPer100g === undefined ? {} : { calories: catalog.caloriesPer100g }),
                ...(catalog.proteinGPer100g === undefined ? {} : { proteinG: catalog.proteinGPer100g }),
                ...(catalog.carbsGPer100g === undefined ? {} : { carbsG: catalog.carbsGPer100g }),
                ...(catalog.fatGPer100g === undefined ? {} : { fatG: catalog.fatGPer100g }),
            };
            const published = Object.keys(figures).length;

            return published === 0 ? { kind: 'noFigures' } : { kind: 'figures', figures, partial: published < 4 };
        }
    }
};

/**
 * Whether food publishes figures for a `RESOLVED` line — the fact SPECIFY.1 rows 3 and 4 differ on — or `undefined`
 * while that is not known. Pure.
 *
 * @param line - The draft line.
 * @param lookup - The editor's nutrition lookup.
 * @returns `published`, `unpublished`, or `undefined`.
 */
export const rowFiguresOf = (line: RecipeFormIngredient, lookup: LineNutritionLookup): RowFigures | undefined => {
    if (line.foodRef === undefined) {
        return undefined;
    }

    const entry = lookup(line.foodRef);

    if (entry.state !== 'found') {
        return undefined;
    }

    const { caloriesPer100g, proteinGPer100g, carbsGPer100g, fatGPer100g } = entry.catalog;

    return [caloriesPer100g, proteinGPer100g, carbsGPer100g, fatGPer100g].some((figure) => figure !== undefined)
        ? 'published'
        : 'unpublished';
};
