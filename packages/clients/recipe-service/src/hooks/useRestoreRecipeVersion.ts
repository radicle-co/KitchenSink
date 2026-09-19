import { useMutation, useQueryClient } from '@tanstack/react-query';

import { recipeServiceKeys } from '../queries.js';
import { useRecipeServiceClient } from './recipeServiceProvider.js';

/**
 * `POST /api/v1/recipes/{id}/versions/{versionNumber}/restore` — restore a recipe to a prior version.
 *
 * A restore is server-side a full recipe update off the snapshot: it rewrites the title/description/times,
 * replaces the ingredient and step sets, bumps `currentVersion`, and records a new version.
 *
 * DA3 — write-through: `data.recipe` is the full, freshly-persisted `RecipeDetail`, so it is written straight
 * into `recipe(id)` instead of invalidating the subtree and forcing a refetch. The response carries no
 * version-LIST shape (only the number it restored from/to), and a restore always records a new version row,
 * so `recipeVersions(id)` still takes an explicit invalidation, alongside lists/search/collection-embeds —
 * list rows render `title` and `currentVersion`, and the snapshot's text rebuilds the row's search vector.
 * Keyed off the mutation's variables: a restore touches exactly one recipe, so a sibling recipe's detail is
 * untouched.
 */
export function useRestoreRecipeVersion() {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (vars: { id: string; versionNumber: number }) =>
            client.restoreRecipeVersion(vars.id, vars.versionNumber),
        onSuccess: async (data, vars) => {
            // Cancel any in-flight `recipe(id)` GET before writing through, so a stale detail fetch settling
            // after this restore cannot clobber the restored detail (symmetric with the other hooks).
            await queryClient.cancelQueries({ queryKey: recipeServiceKeys.recipe(vars.id) });
            queryClient.setQueryData(recipeServiceKeys.recipe(vars.id), data.recipe);
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.recipeVersions(vars.id) });
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.recipeLists });
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.recipeSearches });
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.collections });
        },
    });
}
