/**
 * @module @commise/features-recipes/actions — the ONE rule for "does this visibility change need Premium?", read by every
 * surface that offers Private: the editor's visibility field, the recipe page's ⋯ menu, a collection's ⋯ menu.
 *
 * Owner 2026-10-13: every upsell and paid feature will sit behind a paid-features gate and user roles. That gate is added
 * HERE (and in `useGatedPrivate`, which asks it), so no surface repeats the test. The server holds the matching rule in
 * `collectionVisibilityPolicy` and `visibilityPolicy`; this one only decides whether to show the upsell.
 *
 * @pattern Specification — a pure predicate over the target and the viewer's entitlement
 */
import { RecipeVisibility } from '@kitchensink/recipe-core';

/**
 * Whether moving to `target` needs the Premium plan the viewer lacks. Pure.
 *
 * @param target - The visibility being chosen.
 * @param mayGoPrivate - The viewer's entitlement (`canGoPrivate`).
 * @returns `true` only for Private without the entitlement.
 */
export function privateNeedsPremium(target: RecipeVisibility, mayGoPrivate: boolean): boolean {
    return target === RecipeVisibility.PRIVATE && !mayGoPrivate;
}
