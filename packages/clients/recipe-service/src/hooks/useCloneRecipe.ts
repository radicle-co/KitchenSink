import { useMutation, useQueryClient } from '@tanstack/react-query';

import { recipeServiceKeys } from '../queries.js';
import { useRecipeServiceClient } from './recipeServiceProvider.js';

/**
 * `POST /api/v1/recipes/{id}/clone` — clone a public recipe.
 *
 * DA3 — write-through: the response is the NEW clone's full `RecipeDetail`, so it is written straight into
 * that clone's OWN `recipe(data.id)` (its id, not the source recipe's) instead of forcing a refetch. A fresh
 * clone changes no existing recipe and belongs to no collection, so — unlike update/delete/visibility — only
 * `recipeLists`/`recipeSearches` go stale; `recipes` (broad) and `collections` are deliberately NOT invalidated.
 */
export function useCloneRecipe() {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (id: string) => client.cloneRecipe(id),
        onSuccess: async (data) => {
            // Cancel any in-flight GET for the clone's own id before writing its detail through (symmetric
            // with the other write-through hooks; a fresh clone rarely has one, but keep the guard uniform).
            await queryClient.cancelQueries({ queryKey: recipeServiceKeys.recipe(data.id) });
            queryClient.setQueryData(recipeServiceKeys.recipe(data.id), data);
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.recipeLists });
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.recipeSearches });
        },
    });
}
