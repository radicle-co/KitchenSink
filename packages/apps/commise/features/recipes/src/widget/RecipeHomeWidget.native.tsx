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
import type { RenderRecipeNutrition } from '../nutrition/model.js';
import {
    MAX_RECENT_RECIPES,
    RecentRecipeGrid,
    RecipeWidgetCard,
    RecipeWidgetEmptyState,
    RecipeWidgetSkeleton,
    toRecipeSummary,
} from '../components/index.js';

/**
 * Props for the recipe Home widget (native).
 *
 * The RECIPES arrive as props while the web entry takes a promise, because only web has a server pass to
 * stream one from — the host slot reads them from the shared `useRecipes` query instead.
 *
 * ⚠️ CORRECTION (ADR-0021 §6). This docblock used to justify that with "React Native has no
 * Suspense-for-data streaming". That is true of SERVER streaming (there is no RSC payload to stream into a
 * React Native client) and FALSE of the mechanism: `use(promise)` + `<Suspense>` are client-side React 19 and
 * behave identically here — which is exactly how {@link RecipeHomeWidgetProps.renderNutrition} works. Do not
 * re-derive the old conclusion from the old sentence.
 */
export interface RecipeHomeWidgetProps {
    recipes?: readonly Recipe[];
    isLoading?: boolean;
    /**
     * Navigation seam for a card activation — the mirror of the web entry's prop, so the two platforms expose
     * the same capability. Absent ⇒ the cards render inert.
     */
    readonly onSelectRecipe?: (id: string) => void;
    /**
     * Render one recipe's deferred per-serving calorie figure (see {@link RenderRecipeNutrition}) — the
     * PROMISE-driven half of this widget, and the proof that the premise corrected above was wrong. The host
     * slot closes over the widget's ONE batch promise. Absent ⇒ the cards render no nutrition line.
     */
    readonly renderNutrition?: RenderRecipeNutrition;
}

const RecipeHomeWidget: FC<RecipeHomeWidgetProps> = ({
    recipes = [],
    isLoading = false,
    onSelectRecipe,
    renderNutrition,
}) => {
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
            <RecentRecipeGrid recipes={recent} onSelectRecipe={onSelectRecipe} renderNutrition={renderNutrition} />
        </RecipeWidgetCard>
    );
};

export default RecipeHomeWidget;
