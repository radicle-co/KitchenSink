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
import { RecentRecipeGrid } from '../components/RecentRecipeGrid.js';
import { RecipeWidgetCard } from '../components/RecipeWidgetCard.js';
import { RecipeWidgetEmptyState } from '../components/RecipeWidgetEmptyState.js';
import { MAX_RECENT_RECIPES, toRecipeSummary } from '../components/props.js';

/**
 * Props for the recipe Home widget (native).
 *
 * The RECIPES arrive as settled props while the web entry takes a promise: the host slot reads them with
 * `useSuspenseQuery` under its own `QueryBoundary`, so by the time this leaf renders the read has resolved, and the
 * boundary — not this leaf — owns the loading card and the failure notice. `use(promise)` + `<Suspense>` are
 * client-side React 19 and work identically on React Native (ADR-0021 §6), which is how
 * {@link RecipeHomeWidgetProps.renderNutrition} works; only SERVER streaming is web-only.
 */
export interface RecipeHomeWidgetProps {
    recipes?: readonly Recipe[];
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

const RecipeHomeWidget: FC<RecipeHomeWidgetProps> = ({ recipes = [], onSelectRecipe, renderNutrition }) => {
    const { widgetTitle } = useMessages(recipeMessages);

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
