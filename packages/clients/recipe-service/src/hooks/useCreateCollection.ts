import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { CreateCollectionRequest } from '../types.js';
import { invalidateCollections } from './invalidateCollections.js';
import { useRecipeServiceClient } from './recipeServiceProvider.js';

/** `POST /api/v1/collections` — create a collection. */
export function useCreateCollection() {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (request: CreateCollectionRequest) => client.createCollection(request),
        onSuccess: () => {
            invalidateCollections(queryClient);
        },
    });
}
