/**
 * MOD-019 — session-scoped ingredient checkoff state (FR-032a / REQ-012, REQ-013).
 *
 * Pure reducers over an array of ingredient ids. This module holds **ids only**, never ingredient
 * objects, so the stored recipe cannot be mutated through it (REQ-CN-001).
 *
 * @remarks RED GATE STUB — T-017's tests define the contract and currently fail against these
 * stubs. Implementation lands in T-015's green step.
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
    void state;
    void ingredientId;
    void recipeIngredientIds;
    throw new Error('not implemented');
}

/**
 * Reports whether an ingredient is currently checked.
 *
 * @param state - Currently checked ingredient ids.
 * @param ingredientId - The ingredient to query.
 * @returns `true` when the ingredient is checked.
 */
export function isChecked(state: readonly string[], ingredientId: string): boolean {
    void state;
    void ingredientId;
    throw new Error('not implemented');
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
    void state;
    void recipeIngredientIds;
    throw new Error('not implemented');
}
