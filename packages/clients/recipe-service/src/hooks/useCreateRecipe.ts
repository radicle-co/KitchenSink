import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { CreateRecipeRequest } from '@kitchensink/schema-recipe';

import { useRecipeServiceClient } from './recipeServiceProvider.js';
import { applyRecipeCreated } from './recipeWriteCache.js';

/** `POST /api/v1/recipes` — create a recipe. */
export function useCreateRecipe() {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (input: CreateRecipeRequest) => client.createRecipe(input),
        // One statement of what a create does to the cache, shared with the offline write port (`recipeWriteCache.ts`).
        onSuccess: () => applyRecipeCreated(queryClient),
    });
}
