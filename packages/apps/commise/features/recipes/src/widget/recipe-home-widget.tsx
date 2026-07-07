/**
 * @module @commise/features-recipes/widget/web — web entry for the recipe Home widget.
 *
 * The `./widget/web` package export and the loader seam (`@commise/features-core`
 * {@link HomeWidgetDescriptor.load}) resolve to this module's default export. It
 * composes the platform-neutral building-block barrel (which resolves to the web
 * `*.tsx` leaves) into the recent-recipes card. Data is passed in by the Home host
 * (the widget decides *what* to show; curation decides *whether* it shows).
 */

import type { FC } from 'react';

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
 * Props for the recipe Home widget. `recipes` is the viewer's recent recipes
 * (already fetched by the host or the widget's own data hook); `isLoading` drives
 * the skeleton.
 */
export interface RecipeHomeWidgetProps {
    recipes?: readonly Recipe[];
    isLoading?: boolean;
}

const RecipeHomeWidget: FC<RecipeHomeWidgetProps> = ({ recipes = [], isLoading = false }) => {
    if (isLoading) {
        return (
            <RecipeWidgetCard title={WIDGET_TITLE}>
                <RecipeWidgetSkeleton itemCount={MAX_RECENT_RECIPES} />
            </RecipeWidgetCard>
        );
    }

    const recent = recipes.slice(0, MAX_RECENT_RECIPES).map(toRecipeSummary);

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

export default RecipeHomeWidget;
