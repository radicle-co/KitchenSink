import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { PhotoConfirmRequest } from '../types.js';
import { invalidateRecipeProjections } from './invalidateRecipeProjections.js';
import { useRecipeServiceClient } from './recipeServiceProvider.js';

/** `POST /api/v1/recipes/{id}/photos/confirm` — confirm an uploaded photo. */
export function useConfirmPhotoUpload() {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (vars: { id: string; request: PhotoConfirmRequest }) =>
            client.confirmPhotoUpload(vars.id, vars.request),
        onSuccess: (_result, vars) => {
            invalidateRecipeProjections(queryClient, vars.id);
        },
    });
}
