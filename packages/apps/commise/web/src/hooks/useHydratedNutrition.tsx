'use client';

/**
 * @module useHydratedNutrition — the deferred calorie lookup for a web surface whose rows render on the server.
 *
 * A server-prefetched route (`/recipes`, `/discover`) renders its cards during the Next server pass. The calorie
 * lookup is a render-as-you-fetch read (`useRecipeNutritionBatches`), so left alone it would START there — with a
 * token source that has no session — and suspend each card's boundary on a promise the server cannot settle. React
 * then client-renders every such boundary on hydration and reports each as a recoverable error: one phantom error per
 * card per page view, which buries the signal a real server crash sends.
 *
 * So until the tree has hydrated this starts no read and renders the calorie skeleton — the exact box the slot's own
 * Suspense fallback draws, so there is no layout shift — and from then on it is the ordinary slot over one batch per
 * loaded page. The hydration pass renders the same skeleton the server did, so the two passes agree.
 *
 * @pattern Decorator over the render-as-you-fetch nutrition seam — a hydration gate that is a Null Object on the
 *     server.
 */
import {
    RecipeCalorieSkeleton,
    RecipeNutritionSlot,
    recipeNutritionMessages,
    type RenderRecipeNutrition,
} from '@commise/features-recipes';
import { useRecipeNutritionBatches } from '@commise/features-recipes/hooks';
import { useMessages } from '@commise/i18n/react';
import { useCallback } from 'react';

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

    return useCallback(
        (recipeId: string) => {
            if (!hydrated) {
                return <RecipeCalorieSkeleton label={loadingLabel} />;
            }

            const batch = nutritionFor(recipeId);

            // `null` means no loaded page carries this recipe — we never asked, so the card says nothing rather than
            // mounting a boundary with no promise to settle (a skeleton that renders forever).
            return batch === null ? null : <RecipeNutritionSlot nutritionBatchPromise={batch} recipeId={recipeId} />;
        },
        [hydrated, loadingLabel, nutritionFor],
    );
}
