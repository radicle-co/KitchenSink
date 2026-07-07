/**
 * @module @commise/features-recipes — platform-neutral barrel for the recipe-widget
 * building blocks. Each leaf specifier resolves to its web (`*.tsx`) or native
 * (`*.native.tsx`) implementation at bundle time (web bundler picks `.tsx`; Metro
 * picks `.native.tsx`), so this barrel — and every consumer — is written once.
 */

export { RecipeWidgetCard } from './recipe-widget-card.js';
export { RecentRecipeItem } from './recent-recipe-item.js';
export { RecipeWidgetSkeleton } from './recipe-widget-skeleton.js';
export { RecipeWidgetEmptyState } from './recipe-widget-empty-state.js';

export { MAX_RECENT_RECIPES, toRecipeSummary } from './props.js';
export type {
    RecentRecipeItemProps,
    RecipeSummary,
    RecipeWidgetCardProps,
    RecipeWidgetEmptyStateProps,
    RecipeWidgetSkeletonProps,
} from './props.js';
