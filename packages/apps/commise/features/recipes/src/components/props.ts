/**
 * @module @commise/features-recipes — shared, platform-agnostic props + view-model
 * for the recipe Home-widget building blocks. Web (`*.tsx`) and native
 * (`*.native.tsx`) building-block implementations share these types so the two
 * platform renders stay behind one contract.
 */

import type { ReactNode } from 'react';

import { toRecipeCardModel, type RecipeCardModel } from '../card/model.js';
import type { CardVariant } from '../card/cardVariant.js';
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
/** The heading row's "See all": where it leads (web) and what a press does. */
export interface RecipeWidgetSeeAll {
    /** My recipes' URL, which makes it a real link on web. Native ignores it. */
    readonly href?: string;
    /** Go to My recipes. Web: a plain click. Native: the only navigation. */
    readonly onPress: () => void;
}

/** The first run's three ways in (`docs/design/uiOverhaul/buildSpec.md` §4.2 First run). */
export interface RecipeWidgetFirstRun {
    readonly onCreateRecipe: () => void;
    /** Absent → no paste action (a host with nowhere to paste). */
    readonly onPasteIngredients?: () => void;
    readonly onFindOnDiscover: () => void;
    /** Discover's URL, which makes "Or find one on Discover" a real link on web. Native ignores it. */
    readonly discoverHref?: string;
}

export interface RecipeWidgetCardProps {
    readonly title: string;
    /** "See all" at the end of the heading row. Absent → none (the first run, the fallbacks). */
    readonly seeAll?: RecipeWidgetSeeAll;
    readonly children?: ReactNode;
}

export interface RecentRecipeGridProps {
    readonly recipes: readonly RecipeSummary[];
    /** The card variant the host decided (`cardVariantOf(…, 'home')`). */
    readonly variant: CardVariant;
    readonly onSelectRecipe?: (id: string) => void;
    /** Where a recipe lives, which makes each card a real link on web. Native ignores it. */
    readonly hrefOf?: (id: string) => string;
    /**
     * How to render one card's deferred calorie figure — called once per visible card with its recipe id
     * (see {@link RenderRecipeNutrition}). The host closes over the page's ONE batch promise, so N cards are
     * ONE read. Absent ⇒ no card shows a nutrition line, which is the card's absent-value rule, not a gap.
     */
    readonly renderNutrition?: RenderRecipeNutrition;
}

export interface RecipeWidgetEmptyStateProps {
    /** The ways in. Absent → the line alone. */
    readonly firstRun?: RecipeWidgetFirstRun;
}

export interface RecipeWidgetLoadingCardProps {
    /** The variant the cards will use, so nothing moves when they land. */
    readonly variant: CardVariant;
    /** "See all", kept while the block waits, so the route to My recipes never waits on the content. */
    readonly seeAll?: RecipeWidgetSeeAll;
}

export interface RecipeWidgetLoadErrorProps {
    /** Retry the read. Absent → no button, never a dead one. */
    readonly onRetry?: () => void;
    /** "See all", kept on a failure so the route to My recipes never fails with the content. */
    readonly seeAll?: RecipeWidgetSeeAll;
}
