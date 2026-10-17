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

import type { CardVariant } from '../card/cardVariant.js';
import { recipeMessages } from '../messages.js';
import type { RenderRecipeNutrition } from '../nutrition/model.js';
import { RecentRecipeGrid } from '../components/RecentRecipeGrid.native.js';
import { RecipeWidgetCard } from '../components/RecipeWidgetCard.native.js';
import { RecipeWidgetEmptyState } from '../components/RecipeWidgetEmptyState.native.js';
import {
    MAX_RECENT_RECIPES,
    toRecipeSummary,
    type RecipeWidgetFirstRun,
    type RecipeWidgetSeeAll,
} from '../components/props.js';

/**
 * Props for the recipe Home widget (native).
 *
 * The RECIPES arrive as settled props while the web entry takes a promise: the host slot reads them with
 * `useSuspenseQuery` under its own `QueryBoundary`, which owns the loading and failure states.
 */
export interface RecipeHomeWidgetProps {
    readonly recipes?: readonly Recipe[];
    /** The card variant the host decided (`cardVariantOf(containerClass, …, 'home')`, owner ruling D8). */
    readonly variant: CardVariant;
    /** A card activation. Absent ⇒ the cards render inert. */
    readonly onSelectRecipe?: (id: string) => void;
    /** "See all" at the end of the heading row, while the cook has recipes. */
    readonly seeAll?: RecipeWidgetSeeAll;
    /** The first run's ways in. */
    readonly firstRun?: RecipeWidgetFirstRun;
    /** Render one recipe's deferred per-serving calorie figure (see {@link RenderRecipeNutrition}). */
    readonly renderNutrition?: RenderRecipeNutrition;
}

const RecipeHomeWidget: FC<RecipeHomeWidgetProps> = ({
    recipes = [],
    variant,
    onSelectRecipe,
    seeAll,
    firstRun,
    renderNutrition,
}) => {
    const { widgetTitle } = useMessages(recipeMessages);
    const recent = recipes.slice(0, MAX_RECENT_RECIPES).map(toRecipeSummary);

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
                {...(renderNutrition === undefined ? {} : { renderNutrition })}
            />
        </RecipeWidgetCard>
    );
};

export default RecipeHomeWidget;
