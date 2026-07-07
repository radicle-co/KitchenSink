/**
 * @module @commise/features-recipes — shared, platform-agnostic props + view-model
 * for the recipe Home-widget building blocks. Web (`*.tsx`) and native
 * (`*.native.tsx`) building-block implementations share these types so the two
 * platform renders stay behind one contract.
 */

import type { ReactNode } from 'react';

import type { Recipe } from '@kitchensink/recipe-core';

/**
 * Maximum number of recent recipes the widget shows (US-0 / FR-046: up to 4 most
 * recently viewed or edited recipes).
 */
export const MAX_RECENT_RECIPES = 4;

/**
 * Minimal, platform-agnostic view-model for one recent-recipe row — the subset of
 * a {@link Recipe} the widget renders, so building blocks never depend on the full
 * DTO shape.
 */
export interface RecipeSummary {
    id: string;
    title: string;
    /** ISO 8601 timestamp of the recipe's last update. */
    updatedAt: string;
}

/**
 * Project a {@link Recipe} down to the {@link RecipeSummary} the widget renders.
 */
export const toRecipeSummary = (recipe: Recipe): RecipeSummary => ({
    id: recipe.id,
    title: recipe.title,
    updatedAt: recipe.updatedAt,
});

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
