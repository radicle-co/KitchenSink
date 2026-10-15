/**
 * @module @commise/features-recipes/editor — the visibility write that follows a publish or a Save changes.
 *
 * Visibility is its own endpoint and its own policy (C-004), so it rides behind the recipe's write. The comparison is
 * against what that write's ANSWER says the server holds, never against the editor's seed: a new recipe has no seed
 * recipe, and its create may have gone out public at the draft floor before the cook chose private.
 *
 * ⛔ A change TO private the server is known to refuse (`privateRefusalOf`) is not sent. It would be refused after the
 * editor had already left, and nothing would say so. That happens when the seed was stale (the recipe was made public
 * elsewhere while the editor held Private), or when the draft was kept from before the cook lost the paid features. The
 * editor says the recipe stayed public instead (`finishedNoticeOf`).
 *
 * Pure and platform-agnostic.
 *
 * @pattern Policy — one pure decision of what follows a recipe write
 */
import { RecipeVisibility, type RecipeDetail } from '@kitchensink/recipe-core';

import type { PrivateRefusal } from '../actions/privateGate.js';

/** What follows a recipe write: nothing, the visibility to send, or a Private the server is known to refuse. */
export type VisibilityFollowUp =
    | { readonly kind: 'none' }
    | { readonly kind: 'send'; readonly visibility: RecipeVisibility }
    | { readonly kind: 'refused'; readonly refusal: PrivateRefusal };

/**
 * What follows a recipe write.
 *
 * @param wanted - The cook's choice in the editor.
 * @param stored - The recipe as the write's answer returned it.
 * @param refusal - Why the server would refuse a change to private for this cook, if it is known to (`privateRefusalOf`).
 * @returns `none` when the server holds `wanted`; `refused` for a known-refused change to private; otherwise `send`. Pure.
 */
export function visibilityFollowUp(
    wanted: RecipeVisibility,
    stored: RecipeDetail,
    refusal: PrivateRefusal | undefined,
): VisibilityFollowUp {
    if (wanted === stored.visibility) {
        return { kind: 'none' };
    }

    if (wanted === RecipeVisibility.PRIVATE && refusal !== undefined) {
        return { kind: 'refused', refusal };
    }

    return { kind: 'send', visibility: wanted };
}
