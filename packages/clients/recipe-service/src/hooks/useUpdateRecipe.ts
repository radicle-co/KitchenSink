import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { UpdateRecipeRequest } from '@kitchensink/schema-recipe';

import { useRecipeServiceClient } from './recipeServiceProvider.js';
import { applyRecipeUpdated } from './recipeWriteCache.js';

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
        // One statement of what an update does to the cache, shared with the offline write port (`recipeWriteCache.ts`).
        onSuccess: (data) => applyRecipeUpdated(queryClient, data),
    });
}
