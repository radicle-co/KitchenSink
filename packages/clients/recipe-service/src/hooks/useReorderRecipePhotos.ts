import { useMutation, useQueryClient } from '@tanstack/react-query';

import { invalidateRecipeProjections } from './invalidateRecipeProjections.js';
import { useRecipeServiceClient } from './recipeServiceProvider.js';

/** `PATCH /api/v1/recipes/{id}/photos/reorder` — reorder a recipe's photos. */
export function useReorderRecipePhotos() {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (vars: { id: string; photoIds: readonly string[] }) =>
            client.reorderRecipePhotos(vars.id, vars.photoIds),
        onSuccess: (_result, vars) => {
            invalidateRecipeProjections(queryClient, vars.id);
        },
    });
}
