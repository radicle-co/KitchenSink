import { useMutation, useQueryClient } from '@tanstack/react-query';

import { recipeServiceKeys } from '../queries.js';
import { useRecipeServiceClient } from './recipeServiceProvider.js';

/**
 * `POST /api/v1/ingredients/by-name` — add an unknown food by name through the food service (data-model R5).
 *
 * The ENTRY POINT of the async-resolution vertical: it persists a food-backed catalog row and returns it
 * with a NON-terminal status (`PENDING` / `UNRESOLVED`), which the picker then polls (`useIngredientStatus`)
 * or disambiguates. On success it stales every cached ingredient search (`ingredientSearches`) — a search
 * hit embeds `foodResolutionStatus`, and the newly added/deduped catalog row is now a candidate hit whose
 * badge a cached typeahead would otherwise render stale. It does NOT touch the recipe projections: the row
 * is a shared-catalog entry and changes no recipe/list/search row until a recipe is saved.
 */
export function useAddIngredientByName() {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (name: string) => client.addIngredientByName(name),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.ingredientSearches });
        },
    });
}
