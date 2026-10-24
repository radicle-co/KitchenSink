import { useMutation, useQueryClient } from '@tanstack/react-query';

import { recipeServiceKeys } from '../queries.js';
import { useRecipeServiceClient } from './recipeServiceProvider.js';

/**
 * `POST /api/v1/ingredients/by-food-variant` (curated U9) — bind a variant the cook picked in the details dialog.
 *
 * On success it stales the ingredient typeaheads, as `useAddIngredientByFood` does: the binding now exists,
 * so a search that lists bound foods may list it. A saved recipe's line moves through the rebind command instead
 * (`useRebindIngredientLine` with a `catalogVariant` target), which owns the recipe's own invalidation.
 *
 * @pattern Command — a TanStack mutation over the client method
 */
export function useAddIngredientByFoodVariant() {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (foodVariantId: string) => client.addIngredientByFoodVariant(foodVariantId),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.ingredientSearches });
        },
    });
}
