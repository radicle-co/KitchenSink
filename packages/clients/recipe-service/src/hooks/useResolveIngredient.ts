import { useMutation, useQueryClient } from '@tanstack/react-query';

import { recipeServiceKeys } from '../queries.js';
import { useRecipeServiceClient } from './recipeServiceProvider.js';

/**
 * `POST /api/v1/ingredients/{id}/resolve` — resolve an `UNRESOLVED` ingredient from a candidate pick.
 *
 * On success the ingredient is now `RESOLVED` with nutrition, so this stales exactly the caches that
 * rendered its pre-resolution state: its own poll (`ingredientStatus(id)`), its now-stale candidate set
 * (`ingredientCandidates(id)`), and every cached ingredient search (`ingredientSearches` — a catalog hit
 * embeds `foodResolutionStatus`, which a search list badges). It does NOT touch the recipe projections:
 * resolving nutrition on the shared catalog row changes no recipe/list/search row until a recipe is saved.
 */
export function useResolveIngredient() {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (vars: { id: string; candidateIds: readonly string[] }) =>
            client.resolveIngredient(vars.id, vars.candidateIds),
        onSuccess: (_result, vars) => {
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.ingredientStatus(vars.id) });
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.ingredientCandidates(vars.id) });
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.ingredientSearches });
        },
    });
}
