import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { UpdateCollectionRequest } from '../types.js';
import { invalidateCollections } from './invalidateCollections.js';
import { useRecipeServiceClient } from './recipeServiceProvider.js';

/** `PATCH /api/v1/collections/{id}` — update a collection. */
export function useUpdateCollection() {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (vars: { id: string; request: UpdateCollectionRequest }) =>
            client.updateCollection(vars.id, vars.request),
        onSuccess: () => {
            invalidateCollections(queryClient);
        },
    });
}
