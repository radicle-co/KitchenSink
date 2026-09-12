import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { UpdateRecipeRequest } from '@kitchensink/schema-recipe';

import { recipeServiceKeys } from '../queries.js';
import { useRecipeServiceClient } from './recipeServiceProvider.js';

/**
 * `PATCH /api/v1/recipes/{id}` — update a recipe (optimistic concurrency).
 *
 * DA3 — write-through: the response IS the full, freshly-persisted `RecipeDetail`, so it is written straight
 * into `recipe(id)` (`setQueryData`) instead of invalidating it and forcing a refetch of data the client
 * already has. This is write-AFTER-success only, never an optimistic `onMutate` pre-write — the CAS 409
 * conflict flow (a stale `expectedVersion`) is the entire point of this mutation, and pre-writing the cache
 * would mask a conflict the server is about to reject. The response carries no version-LIST shape to write
 * through, and a PATCH always records a new version row, so `recipeVersions(id)` still takes an explicit
 * invalidation; list/search/collection-embed regions go stale exactly as before.
 */
export function useUpdateRecipe() {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (vars: { id: string; input: UpdateRecipeRequest }) => client.updateRecipe(vars.id, vars.input),
        onSuccess: async (data, vars) => {
            // Cancel any in-flight `recipe(id)` GET before writing through, so a detail fetch that started
            // stale (>staleTime) and settles AFTER this mutation cannot clobber the fresh response with
            // pre-update data (symmetric with the rating hooks' optimistic cancel).
            await queryClient.cancelQueries({ queryKey: recipeServiceKeys.recipe(vars.id) });
            queryClient.setQueryData(recipeServiceKeys.recipe(vars.id), data);
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.recipeVersions(vars.id) });
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.recipeLists });
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.recipeSearches });
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.collections });
        },
    });
}
