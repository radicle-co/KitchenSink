/**
 * @module @commise/features-recipes/widget/mobile — React Native entry for the recipe Home widget.
 *
 * The `./widget/mobile` package export resolves here, and Metro resolves the
 * loader seam's `import('../widget/RecipeHomeWidget.js')` to this `.native.tsx`
 * file. It mirrors the web entry but composes the native (`*.native.tsx`)
 * building-block leaves via the same platform-neutral barrel.
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
 * Props for the recipe Home widget (native). Identical contract to the web entry.
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
