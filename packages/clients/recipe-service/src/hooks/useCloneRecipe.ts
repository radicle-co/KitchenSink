import { useMutation, useQueryClient } from '@tanstack/react-query';

import { recipeServiceKeys } from '../queries.js';
import { useRecipeServiceClient } from './recipeServiceProvider.js';

/**
 * The mutation key every "Save a copy" shares. A card derives its filled / "Saved a copy" state from
 * `useMutationState` filtered on it (`docs/architecture/uiOverhaulBlueprint.md` A14), because the mutation is the
 * source of truth: there is no recipe id for the copy until the server answers, so nothing is written to a cache ahead
 * of it.
 */
export const SAVE_COPY_MUTATION_KEY = ['recipe-service', 'mutations', 'saveCopy'] as const;

/**
 * `POST /api/v1/recipes/{id}/clone` — clone a public recipe.
 *
 * DA3 — write-through: the response is the NEW clone's full `RecipeDetail`, so it is written straight into
 * that clone's OWN `recipe(data.id)` (its id, not the source recipe's) instead of forcing a refetch. A fresh
 * clone changes no existing recipe and belongs to no collection, so — unlike update/delete/visibility — only
 * `recipeLists`/`recipeSearches` go stale; `recipes` (broad) and `collections` are deliberately NOT invalidated.
 *
 * `gcTime: Infinity`: a settled mutation is the record that this recipe has been copied this session. With the default
 * five-minute mutation `gcTime` a card's "Saved a copy" would silently revert to "Save a copy" mid-session and a second
 * press would make a second copy. The cost is one small entry per copy until the client is torn down.
 */
export function useCloneRecipe() {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();

    return useMutation({
        mutationKey: SAVE_COPY_MUTATION_KEY,
        gcTime: Infinity,
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
