/**
 * @module @commise/features-recipes/detail — platform-neutral barrel for the recipe-detail building block
 * (T066). The component specifier resolves to its web (`*.tsx`) or native (`*.native.tsx`) leaf at bundle
 * time; the model layer is platform-agnostic. The apps compose this into their recipe-detail page/screen.
 */
export { RecipeDetailView } from './RecipeDetailView.js';
export { useCookingProgress, type CookingProgressBinding } from './useCookingProgress.js';
export { RecipeSourceLine } from './RecipeSourceLine.js';
export { ServingScaleControl } from './ServingScaleControl.js';
// The serving-scale binding + store are exported for the SESSION seam only (a test reset, and any future
// surface that must read the same scale). The detail view binds them itself — an app never has to.
export { useServingScale, type ServingScaleBinding } from './useServingScale.js';
export { resetServingScale } from './servingScale.js';

export { formatQuantity } from './model.js';
export type {
    RecipeDetailBodyProps,
    RecipeDetailViewProps,
    RecipeSourceLineNativeProps,
    RecipeSourceLineProps,
    ServingScaleControlProps,
} from './model.js';
