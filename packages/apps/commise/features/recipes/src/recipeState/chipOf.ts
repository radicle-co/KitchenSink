/**
 * @module @commise/features-recipes/recipeState/chipOf — the ONE rule for the status chip an owner sees on a recipe.
 *
 * Precedence: Draft, then Hidden, then Public or Private. Hidden is the owner's public recipe that the read rule hides from
 * readers; the wire says so with `hiddenReason`, and its PRESENCE is the whole fact (an unknown reason, and `other`, are
 * Hidden too: the chip tells the truth and the line, if any, is a separate question). A private recipe is Private whatever
 * a stale reason says, because nothing holds a private recipe from readers.
 *
 * Pure.
 *
 * @pattern Specification — one pure predicate-and-pick over facts the screen already holds
 */
import { RecipeStatus, RecipeVisibility } from '@kitchensink/recipe-core';

/** The status chips an owner sees, which are also the keys of the design system's status tones. */
export type RecipeChip = 'draft' | 'hidden' | 'public' | 'private';

/** The facts the chip reads: lifecycle, audience, and the owner-only reason from the wire (an OPEN string). */
export interface ChipFacts {
    readonly status: RecipeStatus;
    readonly visibility: RecipeVisibility;
    readonly hiddenReason?: string | undefined;
}

/**
 * The chip for a recipe.
 *
 * @param recipe - The facts the chip reads.
 * @returns The chip.
 */
export function chipOf(recipe: ChipFacts): RecipeChip {
    if (recipe.status === RecipeStatus.DRAFT) {
        return 'draft';
    }

    if (recipe.visibility === RecipeVisibility.PUBLIC) {
        return recipe.hiddenReason === undefined ? 'public' : 'hidden';
    }

    return 'private';
}
