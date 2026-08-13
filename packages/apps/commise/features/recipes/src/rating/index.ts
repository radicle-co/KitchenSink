/**
 * @module @commise/features-recipes/rating — platform-neutral barrel for the two rating render components
 * (FR-013): the read-only `RecipeRatingDisplay` (own recipe, Sc8) and the interactive
 * `RecipeRatingInput`. The orchestrating container selects between them via `ratingModeFor` — the
 * own-vs-rate decision is NOT a behavior-switching prop on one component (B15). The specifier resolves to its
 * web (`*.tsx`) or native (`*.native.tsx`) leaf at bundle time; the model + messages are platform-agnostic.
 */
export { RecipeRatingDisplay, RecipeRatingInput } from './RecipeRatingControl.js';

export { recipeRatingMessages } from './messages.js';
export type { RecipeRatingMessages } from './messages.js';

export {
    STAR_VALUES,
    formatStarOptionLabel,
    ratingModeFor,
    type RecipeRatingAggregate,
    type RecipeRatingDisplayProps,
    type RecipeRatingError,
    type RecipeRatingInputProps,
    type RecipeRatingMode,
    type StarOptionLabels,
} from './model.js';
