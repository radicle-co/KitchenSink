/**
 * @module @kitchensink/recipe-service-client/hooks — what a recipe write does to the TanStack cache, stated once.
 *
 * Two writers reach the server: the mutation hooks (`useCreateRecipe`, `useUpdateRecipe`, `useDeleteRecipe`) and the offline write port
 * (`@commise/query/sync`'s outbox, whose sender calls the client directly and so bypasses the hooks). Both apply these
 * effects, so a recipe saved through the outbox refreshes the same lists and detail a hook-saved one does.
 */
import type { QueryClient } from '@tanstack/react-query';

import type { RecipeDetail } from '@kitchensink/recipe-core';

import { recipeServiceKeys } from '../queries.js';
import { forgetSavedCopy } from './useCloneRecipe.js';

/**
 * A recipe was created: every recipe query and the search cache must show it.
 *
 * @param queryClient - The app's query client.
 * @sideEffect Invalidates queries.
 */
export function applyRecipeCreated(queryClient: QueryClient): void {
    void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.recipes });
    void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.recipeSearches });
}

/**
 * A recipe was updated: write the response through to its detail (no refetch round-trip, DA3) and refresh what
 * shows it elsewhere.
 *
 * @param queryClient - The app's query client.
 * @param detail - The recipe the server returned.
 * @sideEffect Cancels, writes and invalidates queries.
 */
export async function applyRecipeUpdated(queryClient: QueryClient, detail: RecipeDetail): Promise<void> {
    // Cancel any in-flight `recipe(id)` GET before writing through, so a detail fetch that started stale and settles
    // after this write cannot clobber the fresh response with pre-update data.
    await queryClient.cancelQueries({ queryKey: recipeServiceKeys.recipe(detail.id) });
    queryClient.setQueryData(recipeServiceKeys.recipe(detail.id), detail);
    void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.recipeVersions(detail.id) });
    void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.recipeLists });
    void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.recipeSearches });
    void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.collections });
}

/**
 * A recipe was deleted. The delete answers nothing to write through, so every recipe query, the search cache and every
 * collection embed go stale, and a deleted copy stops counting as saved, so its source's card offers Save a copy again
 * (A-022).
 *
 * @param queryClient - The app's query client.
 * @param id - The id of the recipe that was deleted.
 * @sideEffect Invalidates queries and removes settled save-a-copy mutations.
 */
export function applyRecipeDeleted(queryClient: QueryClient, id: string): void {
    void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.recipes });
    void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.recipeSearches });
    void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.collections });
    forgetSavedCopy(queryClient, id);
}
