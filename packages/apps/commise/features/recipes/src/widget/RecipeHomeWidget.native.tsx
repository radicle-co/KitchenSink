/**
 * @module @commise/features-recipes/widget/mobile — React Native entry for the recipe Home widget.
 *
 * The `./widget/mobile` package export resolves here, and Metro resolves the
 * loader seam's `import('../widget/RecipeHomeWidget.js')` to this `.native.tsx`
 * file. It mirrors the web entry but composes the native (`*.native.tsx`)
 * building-block leaves via the same platform-neutral barrel.
 */

import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import type { Recipe } from '@kitchensink/recipe-core';

import { recipeMessages } from '../messages.js';
import {
    MAX_RECENT_RECIPES,
    RecentRecipeGrid,
    RecipeWidgetCard,
    RecipeWidgetEmptyState,
    RecipeWidgetSkeleton,
    toRecipeSummary,
} from '../components/index.js';

/**
 * Props for the recipe Home widget (native). The data contract is prop-driven rather than promise-driven
 * (React Native has no Suspense-for-data streaming), but the NAVIGATION contract is identical to the web
 * entry's: the widget reports the activated recipe's id and the host routes.
 */
export interface RecipeHomeWidgetProps {
    recipes?: readonly Recipe[];
    isLoading?: boolean;
    /**
     * Navigation seam for a card activation — the mirror of the web entry's prop, so the two platforms expose
     * the same capability. Absent ⇒ the cards render inert.
     */
    readonly onSelectRecipe?: (id: string) => void;
}

const RecipeHomeWidget: FC<RecipeHomeWidgetProps> = ({ recipes = [], isLoading = false, onSelectRecipe }) => {
    const { widgetTitle } = useMessages(recipeMessages);

    if (isLoading) {
        return (
            <RecipeWidgetCard title={widgetTitle}>
                <RecipeWidgetSkeleton itemCount={MAX_RECENT_RECIPES} />
            </RecipeWidgetCard>
        );
    }

    const recent = recipes.slice(0, MAX_RECENT_RECIPES).map(toRecipeSummary);

    if (recent.length === 0) {
        return (
            <RecipeWidgetCard title={widgetTitle}>
                <RecipeWidgetEmptyState />
            </RecipeWidgetCard>
        );
    }

    return (
        <RecipeWidgetCard title={widgetTitle}>
            <RecentRecipeGrid recipes={recent} onSelectRecipe={onSelectRecipe} />
        </RecipeWidgetCard>
    );
};

export default RecipeHomeWidget;
