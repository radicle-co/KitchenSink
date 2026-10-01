import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { RebindIngredientLineRequest } from '@kitchensink/schema-recipe';

import { recipeServiceKeys } from '../queries.js';
import { useRecipeServiceClient } from './recipeServiceProvider.js';

/**
 * `POST /api/v1/recipes/{id}/ingredients/{position}/rebind` — move one line to another food (plan 002 U5).
 *
 * A rebind is a content edit: it runs through the recipe update path, mints a version and answers the full detail.
 * So it follows `useUpdateRecipe`'s cache contract exactly — write the detail through after success (never an
 * optimistic pre-write, because the version compare-and-swap may refuse it), and stale the version list, every
 * recipe list, search and collection.
 *
 * @pattern Command — a TanStack mutation
 */
export function useRebindIngredientLine() {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (vars: { id: string; position: number; body: RebindIngredientLineRequest }) =>
            client.rebindIngredientLine(vars.id, vars.position, vars.body),
        onSuccess: async (data, vars) => {
            // Cancel an in-flight detail GET first, so a stale fetch settling afterwards cannot overwrite the answer.
            await queryClient.cancelQueries({ queryKey: recipeServiceKeys.recipe(vars.id) });
            queryClient.setQueryData(recipeServiceKeys.recipe(vars.id), data);
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.recipeVersions(vars.id) });
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.recipeLists });
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.recipeSearches });
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.collections });
        },
    });
}
