import { useMutation, useQueryClient } from '@tanstack/react-query';

import { recipeServiceKeys } from '../queries.js';
import { useRecipeServiceClient } from './recipeServiceProvider.js';

/**
 * `POST /api/v1/ingredients/by-food` — admit a `catalog` typeahead suggestion as a food-backed ingredient
 * (search Stage 2's pick path).
 *
 * The server creates the row AND backfills its golden-record nutrition in one round-trip, so the ingredient
 * this resolves with is immediately usable on a recipe line — no poll. On success it stales every cached
 * ingredient typeahead (`ingredientSearches`, the shared prefix over `/search` AND `/suggest`): the food now
 * HAS a catalog row, so the very suggestion just picked must move from the `catalog` section to the familiar
 * `local` one. Without this, re-typing the same query would re-offer it as a catalog hit and cost another
 * pointless admit round-trip. It does NOT touch the recipe projections — a shared-catalog row changes no
 * recipe/list/search row until a recipe is saved.
 */
export function useAddIngredientByFood() {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (foodId: string) => client.addIngredientByFood(foodId),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.ingredientSearches });
        },
    });
}
