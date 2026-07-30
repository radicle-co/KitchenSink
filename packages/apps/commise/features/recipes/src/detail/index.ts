/**
 * @module @commise/features-recipes/detail — platform-neutral barrel for the recipe-detail building block
 * (T066). The component specifier resolves to its web (`*.tsx`) or native (`*.native.tsx`) leaf at bundle
 * time; the model layer is platform-agnostic. The apps compose this into their recipe-detail page/screen.
 */
export { RecipeDetailView } from './RecipeDetailView.js';
export { useCookingProgress, type CookingProgressBinding } from './useCookingProgress.js';

export { formatQuantity } from './model.js';
export type { RecipeDetailViewProps } from './model.js';
