import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { CloneCollectionRequest } from '../types.js';
import { invalidateCollections } from './invalidateCollections.js';
import { useRecipeServiceClient } from './recipeServiceProvider.js';

/** `POST /api/v1/collections/{id}/clone` — clone a collection. */
export function useCloneCollection() {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (vars: { id: string; request?: CloneCollectionRequest }) =>
            client.cloneCollection(vars.id, vars.request),
        onSuccess: () => {
            invalidateCollections(queryClient);
        },
    });
}
