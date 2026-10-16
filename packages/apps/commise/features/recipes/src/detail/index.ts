/**
 * @module @commise/features-recipes/detail — the recipe detail screen's shared controller and states.
 *
 * A package-export entry (the one kind of barrel this repo keeps): `@commise/features-recipes/detail`. The render leaves
 * the controller feeds are platform pairs, so each specifier below resolves to its web or native file at bundle time.
 */
export { RecipeDetailDialogs, type RecipeDetailDialogsProps } from './RecipeDetailDialogs.js';
export { RecipeLoadError, type RecipeLoadErrorProps } from './RecipeLoadError.js';
export { recipeLoadMessages, type RecipeLoadMessages } from './messages.js';
export { RecipeDetailRating, type RecipeDetailRatingProps } from './RecipeDetailRating.js';
export {
    useRecipeDetailController,
    type RecipeDetailController,
    type RecipeDetailControllerInput,
    type RecipeDetailNav,
    type RecipeDetailProfile,
} from './useRecipeDetailController.js';
