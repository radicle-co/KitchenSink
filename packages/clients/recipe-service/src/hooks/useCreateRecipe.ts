import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { CreateRecipeRequest } from '@kitchensink/schema-recipe';

import { recipeServiceKeys } from '../queries.js';
import { useRecipeServiceClient } from './recipeServiceProvider.js';

/** `POST /api/v1/recipes` — create a recipe. */
export function useCreateRecipe() {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (input: CreateRecipeRequest) => client.createRecipe(input),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.recipes });
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.recipeSearches });
        },
    });
}
