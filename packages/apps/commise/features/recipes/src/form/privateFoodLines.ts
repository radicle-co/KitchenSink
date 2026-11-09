/**
 * @module @commise/features-recipes/form — which lines of a PUBLIC draft use a food only the cook can see (ADR-0029
 * section 4; private foods spec D2). The server refuses such a recipe, so the editor says so BEFORE Publish: the row
 * shows an attention line, Ingredients is not done, the sections bar counts it and the ready line names it.
 *
 * The fact is each line's `foodVisibility`, from food's LIVE answer (so an approved food reads public at once). A private
 * recipe may hold the same line, so it names none. Publish stays enabled: the server re-checks, because staff can approve a
 * food after the client loaded it.
 *
 * Pure and platform-agnostic.
 */
import { RecipeVisibility } from '@kitchensink/recipe-core';

import type { RecipeFormIngredient, RecipeFormValues } from './values.js';

/** What the rule reads of a draft. */
export interface PrivateFoodDraft {
    readonly visibility: RecipeFormValues['visibility'];
    readonly ingredients: readonly Pick<RecipeFormIngredient, 'foodVisibility'>[];
}

/**
 * The positions of the draft's private-food lines while the draft is public.
 *
 * @param values - The draft.
 * @returns The line positions, in order; empty for a private draft. Pure.
 */
export function privateFoodRowIndexes(values: PrivateFoodDraft): readonly number[] {
    if (values.visibility !== RecipeVisibility.PUBLIC) {
        return [];
    }

    return values.ingredients.flatMap((line, index) => (line.foodVisibility === 'private' ? [index] : []));
}
