import { useMutation, useQueryClient } from '@tanstack/react-query';

import { invalidateRecipeProjections } from './invalidateRecipeProjections.js';
import { useRecipeServiceClient } from './recipeServiceProvider.js';

/** `DELETE /api/v1/recipes/{id}/photos/{photoId}` — delete a photo. */
export function useDeleteRecipePhoto() {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (vars: { id: string; photoId: string }) => client.deleteRecipePhoto(vars.id, vars.photoId),
        onSuccess: (_result, vars) => {
            invalidateRecipeProjections(queryClient, vars.id);
        },
    });
}
