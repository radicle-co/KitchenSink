/**
 * The mobile side of the shared discovery screen's platform port: the plain read boundary (native renders no server
 * HTML, so there is nothing to wait out), the calorie lookup with no hydration gate, and `AsyncStorage` for the recent
 * searches.
 *
 * A module constant on purpose: the shared screen calls `useRenderNutrition`, `useRefreshNotice` and `useRecoverySignal` as hooks, so the object must be stable.
 *
 * @pattern Adapter — the discovery platform port over the mobile app's boundary, nutrition lookup and storage
 */
import { RecipeNutritionSlot, type RenderRecipeNutrition } from '@commise/features-recipes';
import type { DiscoveryPlatform } from '@commise/features-recipes/discovery';
import { useRecipeNutritionBatches } from '@commise/features-recipes/hooks';
import { QueryBoundary } from '@commise/query/boundary';
import { useRecoverySignal } from '@commise/query/recovery-signal';
import { useRefreshNotice } from '@commise/query/refresh-notice';

import { nativeRecentSearchStore } from '../storage/recentSearchStore.js';

/**
 * The host closure every wired surface writes: one slot per card, all reading the SAME batch promise.
 *
 * `null` from the lookup means no batch covers this recipe — render nothing, rather than mounting a boundary with no
 * promise to settle (a skeleton that would never come down).
 *
 * @param recipeIdPages - The recipe ids on screen, grouped as they were LOADED (one page per fetched page).
 * @returns The `renderNutrition` render prop the presentational views call once per card.
 */
function useNativeNutrition(recipeIdPages: readonly (readonly string[])[]): RenderRecipeNutrition {
    const nutritionFor = useRecipeNutritionBatches(recipeIdPages);

    return (recipeId) => {
        const batch = nutritionFor(recipeId);

        return batch === null ? null : <RecipeNutritionSlot nutritionBatchPromise={batch} recipeId={recipeId} />;
    };
}

/** The mobile discovery platform. */
export const nativeDiscoveryPlatform: DiscoveryPlatform = {
    // The extra `prefetchedKeys` a web boundary reads is ignored here: `QueryBoundary` takes the props it knows.
    Boundary: QueryBoundary,
    useRenderNutrition: useNativeNutrition,
    useRefreshNotice,
    useRecoverySignal,
    recentSearchStore: nativeRecentSearchStore,
};
