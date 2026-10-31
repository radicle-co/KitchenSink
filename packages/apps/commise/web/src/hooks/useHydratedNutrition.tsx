'use client';

/**
 * @module useHydratedNutrition — the deferred calorie lookup for a web surface whose rows render on the server.
 *
 * A server-prefetched route (`/recipes`, `/discover`) renders its cards during the Next server pass. The calorie
 * lookup (`useRecipeNutritionBatches`, ADR-0079) reads the client's query cache, and the server's pass and the first
 * client pass need not see the same cache: a batch the client already holds from an earlier visit would render a chip
 * where the server drew a skeleton, and React reports that mismatch as a recoverable error — one per card per page
 * view, which buries the signal a real server crash sends. The server pass also has no session to ask with.
 *
 * So until the tree has hydrated this asks for no pages and renders the calorie skeleton — the exact box the slot's own
 * `pending` reading draws, so there is no layout shift — and from then on it is the ordinary slot over one batch per
 * loaded page. The hydration pass renders the same skeleton the server did, so the two passes agree.
 *
 * @pattern Decorator over the nutrition read seam — a hydration gate that is a Null Object on the server.
 */
import {
    RecipeCalorieSkeleton,
    nutritionSlotRenderer,
    recipeNutritionMessages,
    type RenderRecipeNutrition,
} from '@commise/features-recipes';
import { useRecipeNutritionBatches } from '@commise/features-recipes/hooks';
import { useMessages } from '@commise/i18n/react';
import { useMemo } from 'react';

import { useIsHydrated } from '@/hooks/useIsHydrated';

/** No pages: what the lookup is asked for before hydration, so it issues nothing. */
const NO_PAGES: readonly (readonly string[])[] = [];

/**
 * Render each card's calorie figure, deferring the lookup until the tree has hydrated.
 *
 * @param recipeIdPages - The recipe ids on screen, grouped as they were LOADED (one page per fetched page).
 * @returns A renderer for one card's figure: the skeleton before hydration, its slot after, or nothing for a recipe no
 *     loaded page carries.
 */
export function useHydratedNutrition(recipeIdPages: readonly (readonly string[])[]): RenderRecipeNutrition {
    const hydrated = useIsHydrated();
    const { loadingLabel } = useMessages(recipeNutritionMessages);
    const nutritionFor = useRecipeNutritionBatches(hydrated ? recipeIdPages : NO_PAGES);

    return useMemo(() => {
        if (!hydrated) {
            return () => <RecipeCalorieSkeleton label={loadingLabel} />;
        }

        return nutritionSlotRenderer(nutritionFor);
    }, [hydrated, loadingLabel, nutritionFor]);
}
