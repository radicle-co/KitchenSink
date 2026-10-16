/**
 * @module @commise/features-recipes/versions — the version history screen's shared controller.
 *
 * A package-export entry (the one kind of barrel this repo keeps): web's `RecipeVersionsContainer` and mobile's
 * `RecipeVersionsScreen` each keep their read boundary, loading and failed states and way back, and take the settled
 * history from here.
 */
export { RecipeVersionsView } from './RecipeVersionsView.js';
export type { RecipeVersionsViewProps } from './RecipeVersionsView.js';
export { useRecipeVersions } from './useRecipeVersions.js';
export type { RecipeVersionsInput, RecipeVersionsSession } from './useRecipeVersions.js';
