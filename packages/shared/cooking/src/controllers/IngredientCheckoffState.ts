import { UnknownIngredientError } from '../errors.js';

/**
 * MOD-019 — session-scoped ingredient checkoff state (FR-032a / REQ-012, REQ-013).
 *
 * Pure reducers over an array of ingredient ids. This module holds **ids only**, never ingredient
 * objects, so the stored recipe cannot be mutated through it (REQ-CN-001).
 */

/**
 * Toggles one ingredient's checked state, returning a new array.
 *
 * @param state - Currently checked ingredient ids.
 * @param ingredientId - The ingredient to toggle.
 * @param recipeIngredientIds - Every ingredient id the current recipe contains.
 * @returns The new checked-id array. Never mutates `state`.
 * @throws {UnknownIngredientError} When `ingredientId` is absent from `recipeIngredientIds`.
 */
export function toggleIngredient(
    state: readonly string[],
    ingredientId: string,
    recipeIngredientIds: readonly string[],
): string[] {
    if (!recipeIngredientIds.includes(ingredientId)) {
        // Fail loudly rather than silently no-opping: a checkoff that appears to do nothing is a
        // worse kitchen experience than a surfaced error, and it hides caller bugs.
        throw new UnknownIngredientError(ingredientId);
    }

    // `filter` rather than `splice` on a found index: it removes any accidental duplicate and, being
    // non-mutating, keeps the caller's array intact (asserted by UTS-019-A4).
    return state.includes(ingredientId) ? state.filter((id) => id !== ingredientId) : [...state, ingredientId];
}

/**
 * Reports whether an ingredient is currently checked.
 *
 * @param state - Currently checked ingredient ids.
 * @param ingredientId - The ingredient to query.
 * @returns `true` when the ingredient is checked.
 */
export function isChecked(state: readonly string[], ingredientId: string): boolean {
    return state.includes(ingredientId);
}

/**
 * Drops checked ids that the recipe no longer contains.
 *
 * Called on session restore: an ingredient removed from the recipe since the session started must
 * not linger as a checked ghost id.
 *
 * @param state - Restored checked ingredient ids.
 * @param recipeIngredientIds - Every ingredient id the current recipe contains.
 * @returns The reconciled checked-id array.
 */
export function reconcile(state: readonly string[], recipeIngredientIds: readonly string[]): string[] {
    // Silent by design, unlike `toggleIngredient`: a ghost id after restore means the recipe changed
    // underneath the session, which is not the user's error and needs no interruption mid-cook.
    return state.filter((id) => recipeIngredientIds.includes(id));
}
