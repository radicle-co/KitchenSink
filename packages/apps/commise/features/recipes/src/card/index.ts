/**
 * @module @commise/features-recipes/card — platform-neutral barrel for the shared mockup-parity recipe card.
 * `RecipeCard` resolves to its web (`*.tsx`) or native (`*.native.tsx`) leaf at bundle time; the model layer
 * is platform-agnostic. Consumed by BOTH the Home widget and the recipe list so the two cards never drift.
 */
export { RecipeCard } from './RecipeCard.js';
export type { RecipeCardProps } from './RecipeCard.js';

export {
    STAR_COUNT,
    difficultyTone,
    formatAverageRating,
    formatRatingCount,
    toRecipeCardModel,
    toStarFills,
} from './model.js';
export type { DifficultyTone, RatingCountLabels, RecipeCardModel } from './model.js';
