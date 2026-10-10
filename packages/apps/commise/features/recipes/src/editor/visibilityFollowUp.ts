/**
 * @module @commise/features-recipes/editor — the visibility write that follows a publish or a Save changes.
 *
 * Visibility is its own endpoint and its own policy (C-004), so it rides behind the recipe's write. The comparison is
 * against what that write's ANSWER says the server holds, never against the editor's seed: a new recipe has no seed
 * recipe, and its create may have gone out public at the draft floor before the cook chose private.
 *
 * Pure and platform-agnostic.
 */
import type { RecipeDetail, RecipeVisibility } from '@kitchensink/recipe-core';

/**
 * The visibility to send after a recipe write, if any.
 *
 * @param wanted - The cook's choice in the editor.
 * @param stored - The recipe as the write's answer returned it.
 * @returns `wanted` when the server holds the other visibility; otherwise `undefined`. Pure.
 */
export function visibilityFollowUp(wanted: RecipeVisibility, stored: RecipeDetail): RecipeVisibility | undefined {
    return wanted === stored.visibility ? undefined : wanted;
}
