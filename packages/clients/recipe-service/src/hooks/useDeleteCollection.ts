import { useMutation, useQueryClient } from '@tanstack/react-query';

import { invalidateCollections } from './invalidateCollections.js';
import { useRecipeServiceClient } from './recipeServiceProvider.js';

/** `DELETE /api/v1/collections/{id}` — delete a collection. */
export function useDeleteCollection() {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (id: string) => client.deleteCollection(id),
        onSuccess: () => {
            invalidateCollections(queryClient);
        },
    });
}
