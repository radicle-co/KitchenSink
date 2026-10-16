/**
 * @module @commise/features-recipes/list — the recipe library list's shared state: the controls above the suspense
 * boundary (search, chips, sort, the read they key) and the settled library's view-model (flatten, facets, narrowing,
 * state, load-more).
 *
 * A package-export entry (the one kind of barrel this repo keeps). The list's render leaves stay on the package root;
 * this entry carries only the hooks, which both platforms' containers share.
 */
export { useRecipeLibrary } from './useRecipeLibrary.js';
export type { LibraryQuery, RecipeLibraryInput, RecipeLibraryModel } from './useRecipeLibrary.js';
export { useRecipeLibraryControls } from './useRecipeLibraryControls.js';
export type { LibraryRead, RecipeLibraryControls } from './useRecipeLibraryControls.js';
