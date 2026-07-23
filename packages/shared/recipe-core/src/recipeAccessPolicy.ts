/**
 * @module @kitchensink/recipe-core/recipeAccessPolicy — the recipe authorization/visibility Specification
 * module (P4).
 *
 * A composable set of pure, total predicates deciding what a {@link Viewer} may do with a recipe —
 * ownership, cloning, rating, and the premium private-visibility gate. Each predicate is a single
 * authoritative representation of its rule, called identically by every platform, so web and mobile can
 * never diverge on a gate the way they did on the clone gate (D7: web read `isPublic`, mobile read
 * `isPublic && !isOwner` — two different rules for the same button).
 *
 * SECURITY-RELEVANT: every predicate here fails closed. An absent viewer id can never satisfy `isOwner`
 * (so it can never masquerade as the owner and, downstream, hide a rating control or unlock an edit
 * surface), and an absent/unrecognized tier can never satisfy `canGoPrivate`. These are the client-side
 * half of each gate — the backend is the real enforcement boundary — but the client predicates must agree
 * with it, and with each other, or the UI lies about what an action will do.
 */
import type { Recipe } from './recipe.types.js';
import { RecipeVisibility } from './recipe.types.js';
import { rankTier, type Viewer } from './viewer.js';

/**
 * Whether `viewer` owns `recipe`. True iff the viewer's id is KNOWN and matches the recipe's `ownerId`
 * exactly — a transposed or absent viewer id never satisfies this (fail-safe: an unauthenticated/unresolved
 * viewer can never masquerade as the owner). Pure.
 *
 * @param recipe - The recipe's `ownerId`.
 * @param viewer - The viewer to check.
 * @returns True iff the viewer owns the recipe.
 */
export function isOwner(recipe: Pick<Recipe, 'ownerId'>, viewer: Viewer): boolean {
    return viewer.id !== undefined && viewer.id === recipe.ownerId;
}

/**
 * Whether `viewer` may rate `recipe` (FR-013 / Sc8). A viewer may rate a recipe they can see and do not
 * own: rating requires a KNOWN viewer id (an anonymous/unresolved viewer cannot rate) and never the owner
 * (self-rating is forbidden). Pure.
 *
 * @param recipe - The recipe's `ownerId`.
 * @param viewer - The viewer to check.
 * @returns True iff the viewer may rate the recipe.
 */
export function canRate(recipe: Pick<Recipe, 'ownerId'>, viewer: Viewer): boolean {
    return viewer.id !== undefined && !isOwner(recipe, viewer);
}

/**
 * Whether `viewer` may clone `recipe` (T075 / D7). A viewer may clone a PUBLIC recipe they do not own —
 * cloning a private recipe, or one's own recipe (public or private), is never allowed. This is the single
 * authority both web and mobile now read, closing the D7 drift where the two platforms disagreed on
 * whether an owner viewing their own public recipe could clone it. Pure.
 *
 * @param recipe - The recipe's `visibility` and `ownerId`.
 * @param viewer - The viewer to check.
 * @returns True iff the viewer may clone the recipe.
 */
export function canClone(recipe: Pick<Recipe, 'visibility' | 'ownerId'>, viewer: Viewer): boolean {
    return recipe.visibility === RecipeVisibility.PUBLIC && !isOwner(recipe, viewer);
}

/**
 * Whether `viewer` may set a recipe's visibility to PRIVATE (C-004). A premium-only capability: gated on
 * the viewer's tier ranking at least `'premium'` on the {@link rankTier} ladder. Fails closed to `false`
 * when the tier is unknown (an unresolved/absent tier is never treated as premium). Pure.
 *
 * @param viewer - The viewer to check.
 * @returns True iff the viewer's tier permits a private recipe.
 */
export function canGoPrivate(viewer: Viewer): boolean {
    return rankTier(viewer.tier) >= rankTier('premium');
}
