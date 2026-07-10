/**
 * @module @commise/features-recipes/widget/web — web entry for the recipe Home widget.
 *
 * The `./widget/web` package export and the loader seam (`@commise/features-core`
 * {@link HomeWidgetDescriptor.load}) resolve to this module's default export. It composes the
 * platform-neutral building-block barrel (which resolves to the web `*.tsx` leaves) into the
 * recent-recipes card.
 *
 * Loading is expressed with React Suspense — the Next.js / React 19 idiom — NOT an imperative
 * `isLoading` flag: the Home host kicks off the recipes fetch and hands the widget the *promise* (a
 * server component can create `client.listRecipes()` without awaiting it and stream it across the RSC
 * boundary); the widget `use()`s it inside its own `<Suspense>` boundary, so the skeleton is the
 * declarative fallback while the data streams in. (The mobile `.native.tsx` widget keeps a prop-driven
 * `isLoading` — React Native has no Suspense-for-data streaming.)
 */
'use client';

import { Suspense, use, type FC } from 'react';

import type { Recipe } from '@kitchensink/recipe-core';

import {
    MAX_RECENT_RECIPES,
    RecentRecipeItem,
    RecipeWidgetCard,
    RecipeWidgetEmptyState,
    RecipeWidgetSkeleton,
    toRecipeSummary,
} from '../components/index.js';

const WIDGET_TITLE = 'Recent recipes';

/**
 * Props for the recipe Home widget (web). `recipesPromise` is the viewer's recent recipes as a PROMISE
 * the host starts (and does not await), so the widget streams under Suspense instead of branching on a
 * loading flag.
 */
export interface RecipeHomeWidgetProps {
    recipesPromise: Promise<readonly Recipe[]>;
}

/** The card shown while the recipes promise is still pending — the Suspense fallback. */
const RecipeHomeWidgetFallback: FC = () => (
    <RecipeWidgetCard title={WIDGET_TITLE}>
        <RecipeWidgetSkeleton itemCount={MAX_RECENT_RECIPES} />
    </RecipeWidgetCard>
);

/** Suspends on the recipes promise via `use`, then renders the empty state or the recent-recipes list. */
const RecipeHomeWidgetContent: FC<RecipeHomeWidgetProps> = ({ recipesPromise }) => {
    const recent = use(recipesPromise).slice(0, MAX_RECENT_RECIPES).map(toRecipeSummary);

    if (recent.length === 0) {
        return (
            <RecipeWidgetCard title={WIDGET_TITLE}>
                <RecipeWidgetEmptyState />
            </RecipeWidgetCard>
        );
    }

    return (
        <RecipeWidgetCard title={WIDGET_TITLE}>
            {recent.map((recipe) => (
                <RecentRecipeItem key={recipe.id} recipe={recipe} />
            ))}
        </RecipeWidgetCard>
    );
};

/**
 * The recipe Home widget (web): a `<Suspense>` boundary whose fallback is the skeleton card and whose
 * content suspends on the recipes promise — the loading state is declarative, not an `isLoading` branch.
 */
const RecipeHomeWidget: FC<RecipeHomeWidgetProps> = ({ recipesPromise }) => (
    <Suspense fallback={<RecipeHomeWidgetFallback />}>
        <RecipeHomeWidgetContent recipesPromise={recipesPromise} />
    </Suspense>
);

export default RecipeHomeWidget;
