/**
 * @module @commise/features-recipes/hooks — how long an ingredient search waits after a keystroke before it asks
 * (REQ-057). Both ingredient searches read it: the editor's entry (`useIngredientEntry`) and the recipe filter's
 * (`useIngredientFilterSearch`).
 *
 * ⚠️ It stays this package's, unlike the search minimum (`@kitchensink/recipe-core/resolution/search-minimum`): it is an
 * interaction concern with no server counterpart, and it changes for other reasons than the minimum does.
 */

/** The debounce window (ms) between a keystroke and the search it triggers (REQ-057). */
export const INGREDIENT_SEARCH_DEBOUNCE_MS = 300;
