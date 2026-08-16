/**
 * @module @commise/features-recipes/nutrition — platform-neutral barrel for the deferred calorie lookup.
 *
 * `RecipeCalorieChip`, `RecipeCalorieSkeleton` and `RecipeNutritionBoundary` each resolve to their web
 * (`*.tsx`) or native (`*.native.tsx`) leaf at bundle time; the model and the copy are platform-agnostic, so
 * a consumer imports the SAME names on both platforms and the two can never drift on what they say.
 *
 * A consumer normally needs only {@link RecipeNutritionBoundary} — it selects the other two. The chip and
 * skeleton are exported for the surfaces that already hold a settled reading (no promise to suspend on) and
 * for the tests that must reach each state directly.
 */
export { RecipeCalorieChip } from './RecipeCalorieChip.js';
export type { RecipeCalorieChipProps } from './RecipeCalorieChip.js';

export { RecipeCalorieSkeleton } from './RecipeCalorieSkeleton.js';
export type { RecipeCalorieSkeletonProps } from './RecipeCalorieSkeleton.js';

export { RecipeNutritionBoundary } from './RecipeNutritionBoundary.js';
export type { RecipeNutritionBoundaryProps } from './RecipeNutritionBoundary.js';

export { NUTRITION_FOOD_UNAVAILABLE, toCalorieChipModel, unaccountedReasonText } from './model.js';
export type {
    RecipeCalorieChipModel,
    RecipeCaloriePending,
    RecipeCalorieReading,
    RecipeCalorieState,
    RecipeCalorieUnaccounted,
    RecipeCalorieUnaccountedReason,
    RecipeNutritionViewState,
} from './model.js';

export { recipeNutritionMessages } from './messages.js';
export type { RecipeNutritionMessages } from './messages.js';
