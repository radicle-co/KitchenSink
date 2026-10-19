import { useMutation, useQueryClient } from '@tanstack/react-query';

import { applyRecipeDeleted } from './recipeWriteCache.js';
import { useRecipeServiceClient } from './recipeServiceProvider.js';

/** `DELETE /api/v1/recipes/{id}` — soft-delete a recipe. */
export function useDeleteRecipe() {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (id: string) => client.deleteRecipe(id),
        onSuccess: (_data, id) => {
            // One statement of what a delete does to the cache, shared with the offline write port (`recipeWriteCache.ts`).
            applyRecipeDeleted(queryClient, id);
        },
    });
}
