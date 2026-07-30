/**
 * @module @commise/features-recipes — platform-neutral barrel for the recipe-widget
 * building blocks. Each leaf specifier resolves to its web (`*.tsx`) or native
 * (`*.native.tsx`) implementation at bundle time (web bundler picks `.tsx`; Metro
 * picks `.native.tsx`), so this barrel — and every consumer — is written once.
 */

export { RecipeWidgetCard } from './RecipeWidgetCard.js';
export { RecentRecipeItem } from './RecentRecipeItem.js';
export { RecentRecipeGrid } from './RecentRecipeGrid.js';
export { RecipeWidgetSkeleton } from './RecipeWidgetSkeleton.js';
export { RecipeWidgetEmptyState } from './RecipeWidgetEmptyState.js';

export { MAX_RECENT_RECIPES, toRecipeSummary } from './props.js';
export type {
    RecentRecipeGridProps,
    RecentRecipeItemProps,
    RecipeSummary,
    RecipeWidgetCardProps,
    RecipeWidgetEmptyStateProps,
    RecipeWidgetSkeletonProps,
} from './props.js';
