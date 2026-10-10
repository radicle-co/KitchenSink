/**
 * @module @commise/features-recipes/widget/web — web entry for the recipe Home widget.
 *
 * The `./widget/web` package export and the loader seam (`@commise/features-core`
 * `HomeWidgetDescriptor.load`) resolve to this module's default export. It composes the
 * platform-neutral building-block barrel (which resolves to the web `*.tsx` leaves) into the
 * recent-recipes card.
 *
 * Loading is expressed with React Suspense — the Next.js / React 19 idiom — NOT an imperative
 * `isLoading` flag: the Home host kicks off the recipes fetch and hands the widget the *promise* (a
 * server component can create `client.listRecipes()` without awaiting it and stream it across the RSC
 * boundary); the widget `use()`s it inside its own `<Suspense>` boundary, so the skeleton is the
 * declarative fallback while the data streams in. (The mobile `.native.tsx` widget takes settled props: its host
 * slot suspends on the read under a `QueryBoundary` instead.)
 */
'use client';

import { useMessages } from '@commise/i18n/react';
import { Suspense, use, type FC } from 'react';

import type { Recipe } from '@kitchensink/recipe-core';

import type { CardVariant } from '../card/cardVariant.js';
import { recipeMessages } from '../messages.js';
import type { RenderRecipeNutrition } from '../nutrition/model.js';
import { RecentRecipeGrid } from '../components/RecentRecipeGrid.js';
import { RecipeWidgetCard } from '../components/RecipeWidgetCard.js';
import { RecipeWidgetEmptyState } from '../components/RecipeWidgetEmptyState.js';
import { RecipeWidgetLoadingCard } from '../components/RecipeWidgetLoadingCard.js';
import {
    MAX_RECENT_RECIPES,
    toRecipeSummary,
    type RecipeWidgetFirstRun,
    type RecipeWidgetSeeAll,
} from '../components/props.js';

/**
 * Props for the recipe Home widget (web). `recipesPromise` is the viewer's recent recipes as a PROMISE the host starts
 * (and does not await), so the widget streams under Suspense instead of branching on a loading flag.
 */
export interface RecipeHomeWidgetProps {
    readonly recipesPromise: Promise<readonly Recipe[]>;
    /** The card variant the host decided (`cardVariantOf(containerClass, …, 'home')`, owner ruling D8). */
    readonly variant: CardVariant;
    /** A card activation. Absent ⇒ the cards render inert. The HOST routes. */
    readonly onSelectRecipe?: (id: string) => void;
    /** Where a recipe lives, which makes each card a real link. */
    readonly hrefOf?: (id: string) => string;
    /** "See all" at the end of the heading row, while the cook has recipes. */
    readonly seeAll?: RecipeWidgetSeeAll;
    /** The first run's ways in. */
    readonly firstRun?: RecipeWidgetFirstRun;
    /**
     * Per-card calorie slot (ADR-0021). A RENDER PROP, so this widget stays a pure `props → JSX` leaf and never learns
     * what a promise, a batch or a `QueryClient` is — the HOST owns the lookup.
     */
    readonly renderNutrition?: RenderRecipeNutrition;
}

/**
 * Suspends on the recipes promise via `use`, then SELECTS the render component: the first run when the cook has none,
 * else the recent-recipes grid. The choice lives here rather than as a mode prop on one component.
 */
const RecipeHomeWidgetContent: FC<RecipeHomeWidgetProps> = ({
    recipesPromise,
    variant,
    onSelectRecipe,
    hrefOf,
    seeAll,
    firstRun,
    renderNutrition,
}) => {
    const { widgetTitle } = useMessages(recipeMessages);
    const recent = use(recipesPromise).slice(0, MAX_RECENT_RECIPES).map(toRecipeSummary);

    if (recent.length === 0) {
        return (
            <RecipeWidgetCard title={widgetTitle}>
                <RecipeWidgetEmptyState {...(firstRun === undefined ? {} : { firstRun })} />
            </RecipeWidgetCard>
        );
    }

    return (
        <RecipeWidgetCard title={widgetTitle} {...(seeAll === undefined ? {} : { seeAll })}>
            <RecentRecipeGrid
                recipes={recent}
                variant={variant}
                {...(onSelectRecipe === undefined ? {} : { onSelectRecipe })}
                {...(hrefOf === undefined ? {} : { hrefOf })}
                {...(renderNutrition === undefined ? {} : { renderNutrition })}
            />
        </RecipeWidgetCard>
    );
};

/**
 * The recipe Home widget (web): a `<Suspense>` boundary whose fallback is the block's loading state and whose content
 * suspends on the recipes promise.
 *
 * ⚠️ EVERY prop is threaded to the content component, `renderNutrition` included: the split across a Suspense hop is
 * exactly where a prop goes missing without a compile error.
 */
const RecipeHomeWidget: FC<RecipeHomeWidgetProps> = (props) => (
    <Suspense fallback={<RecipeWidgetLoadingCard variant={props.variant} />}>
        <RecipeHomeWidgetContent {...props} />
    </Suspense>
);

export default RecipeHomeWidget;
