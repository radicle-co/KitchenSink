import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { RecipeVisibility } from '@kitchensink/recipe-core';

import { recipeServiceKeys } from '../queries.js';
import { useRecipeServiceClient } from './recipeServiceProvider.js';

/**
 * `PATCH /api/v1/recipes/{id}/visibility` — set a recipe's visibility.
 *
 * DA3 — write-through: the response is the full, freshly-persisted `RecipeDetail`, so it is written straight
 * into `recipe(id)` instead of invalidating it. A visibility flip is confirmed (against the server DAL) to be
 * a pure single-column metadata UPDATE with no `recipe_versions` insert and no `currentVersion` bump — unlike
 * a content edit or a restore — so `recipeVersions(id)` is deliberately NOT invalidated here.
 *
 * DA4 follow-on: this is a genuinely optimistic-worthy write (a toggle the viewer expects to flip instantly),
 * but layering `onMutate`/`onError` on top of DA3's write-through would need its own red→green pass (today's
 * `onSuccess`-only invalidation is a pinned, deliberate contract — see the tests keyed `VISIBILITY_PROBES`,
 * and note `useSetRecipeRating` / `useDeleteRecipeRating` settled on this SAME shape: reconcile on success,
 * rollback-only on error, no invalidation on failure). Deferred out of DA4's required scope (rating) rather
 * than risk a rushed change
 * to that contract; not yet implemented.
 */
export function useSetRecipeVisibility() {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (vars: { id: string; visibility: RecipeVisibility }) =>
            client.setRecipeVisibility(vars.id, vars.visibility),
        onSuccess: async (data, vars) => {
            // Cancel any in-flight `recipe(id)` GET before writing through, so a stale detail fetch settling
            // after this visibility change cannot clobber the fresh response (symmetric with the other hooks).
            await queryClient.cancelQueries({ queryKey: recipeServiceKeys.recipe(vars.id) });
            queryClient.setQueryData(recipeServiceKeys.recipe(vars.id), data);
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.recipeLists });
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.recipeSearches });
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.collections });
        },
    });
}
