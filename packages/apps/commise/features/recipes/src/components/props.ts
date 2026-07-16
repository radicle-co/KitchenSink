/**
 * @module @commise/features-recipes — shared, platform-agnostic props + view-model
 * for the recipe Home-widget building blocks. Web (`*.tsx`) and native
 * (`*.native.tsx`) building-block implementations share these types so the two
 * platform renders stay behind one contract.
 */

import type { ReactNode } from 'react';

import { toRecipeCardModel, type RecipeCardModel } from '../card/model.js';

/**
 * Maximum number of recent recipes the widget shows (US-0 / FR-046: up to 4 most
 * recently viewed or edited recipes).
 */
export const MAX_RECENT_RECIPES = 4;

/**
 * View-model for one recent-recipe card in the Home widget. This is the SHARED card view-model
 * ({@link RecipeCardModel}): the widget and the recipe list draw the identical mockup card, so they render
 * the same shape and project through the same {@link toRecipeSummary}. Kept as a named alias so existing
 * widget imports (`RecipeSummary`) stay stable.
 */
export type RecipeSummary = RecipeCardModel;

/**
 * Project a {@link import('@kitchensink/recipe-core').Recipe} down to the {@link RecipeSummary} the widget
 * card renders — the single shared card projection, so the widget and list can never disagree on card fields.
 */
export const toRecipeSummary = toRecipeCardModel;

/**
 * Props for the widget card shell (title + body slot).
 */
export interface RecipeWidgetCardProps {
    title: string;
    children?: ReactNode;
}

/**
 * Props for a single recent-recipe row.
 */
export interface RecentRecipeItemProps {
    recipe: RecipeSummary;
}

/**
 * Props for the loading skeleton.
 */
export interface RecipeWidgetSkeletonProps {
    itemCount?: number;
}

/**
 * Props for the empty state (a **live** widget with no data — never used for an
 * absent/gated widget).
 */
export interface RecipeWidgetEmptyStateProps {
    message?: string;
}
