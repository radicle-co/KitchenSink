/**
 * @module @commise/features-recipes/rating — platform-neutral barrel for the interactive rating control
 * (FR-013). The component specifier resolves to its web (`*.tsx`) or native (`*.native.tsx`) leaf at bundle
 * time; the model + messages are platform-agnostic. The apps compose this onto the recipe-detail surface.
 */
export { RecipeRatingControl } from './RecipeRatingControl.js';

export { recipeRatingMessages } from './messages.js';
export type { RecipeRatingMessages } from './messages.js';

export {
    STAR_VALUES,
    formatStarOptionLabel,
    ratingModeFor,
    resolveSelectedStars,
    type RatingSelectionOverride,
    type RecipeRatingControlProps,
    type RecipeRatingError,
    type RecipeRatingMode,
    type StarOptionLabels,
} from './model.js';
