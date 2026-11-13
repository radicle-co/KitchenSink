/**
 * @module @commise/features-recipes/cook — the narrow surface cooking mode takes from the recipe page: its ingredient
 * row, its servings stepper, its amount formatter and the two bindings, so cooking mode shows the same row and the same
 * numbers and never reaches the root barrel or `./detail`. This file is the target of the `./cook` entry in
 * `package.json`. The surface is pinned by `__tests__/cookSurface.test.ts`.
 */
export { formatAmount } from '../detail/model.js';
export { IngredientCheckRow } from '../detail/IngredientCheckRow.js';
export { ServingScaleControl } from '../detail/ServingScaleControl.js';
export { useCookMarks, type CookMarksBinding } from '../detail/useCookMarks.js';
export { useServingScale, type ServingScaleBinding } from '../detail/useServingScale.js';
