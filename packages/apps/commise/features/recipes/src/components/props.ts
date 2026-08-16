/**
 * @module @commise/features-recipes — shared, platform-agnostic props + view-model
 * for the recipe Home-widget building blocks. Web (`*.tsx`) and native
 * (`*.native.tsx`) building-block implementations share these types so the two
 * platform renders stay behind one contract.
 */

import type { ReactNode } from 'react';

import { toRecipeCardModel, type RecipeCardModel } from '../card/model.js';
import type { RenderRecipeNutrition } from '../nutrition/model.js';

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
 * Project a `Recipe` (`@kitchensink/recipe-core`) down to the {@link RecipeSummary} the widget
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
 * Props for a single recent-recipe card.
 *
 * `onSelect` is the NAVIGATION seam: the card itself performs no routing (a presentational leaf owns no
 * navigation), it only reports which recipe was activated. The composing host — the app's Home widget slot,
 * which is the only layer that knows the platform's router — turns that id into a route. ABSENT `onSelect`
 * renders an inert card rather than a dead button, so a surface that has no destination never presents a
 * control that does nothing.
 */
export interface RecentRecipeItemProps {
    recipe: RecipeSummary;
    readonly onSelect?: (id: string) => void;
    /**
     * This recipe's per-serving nutrition, as an already-decided NODE for the card's meta row (the host
     * closes over the page's ONE batch promise — see `RenderRecipeNutrition`). Absent ⇒ no nutrition line.
     */
    readonly nutrition?: ReactNode;
}

/**
 * Props for the recent-recipes card grid — the mockup's `screen-home` "Recent Recipes" layout (2-up on
 * phones, 4-up from `md`). Carries the same `onSelectRecipe` navigation seam as {@link RecentRecipeItemProps},
 * threaded to every cell.
 */
export interface RecentRecipeGridProps {
    readonly recipes: readonly RecipeSummary[];
    readonly onSelectRecipe?: (id: string) => void;
    /**
     * How to render one card's deferred calorie figure — called once per visible card with its recipe id
     * (see {@link RenderRecipeNutrition}). The host closes over the page's ONE batch promise, so N cards are
     * ONE read. Absent ⇒ no card shows a nutrition line, which is the card's absent-value rule, not a gap.
     */
    readonly renderNutrition?: RenderRecipeNutrition;
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
