import { useMutation, useQueryClient } from '@tanstack/react-query';

import { recipeServiceKeys } from '../queries.js';
import { useRecipeServiceClient } from './recipeServiceProvider.js';

/** `POST /api/v1/collections/{id}/recipes` — add a recipe to a collection. */
export function useAddRecipeToCollection() {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (vars: { id: string; recipeId: string }) => client.addRecipeToCollection(vars.id, vars.recipeId),
        onSuccess: (_result, vars) => {
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.collection(vars.id) });
        },
    });
}
