import { useMutation, useQueryClient } from '@tanstack/react-query';

import { recipeServiceKeys } from '../queries.js';
import { useRecipeServiceClient } from './recipeServiceProvider.js';

/** `DELETE /api/v1/collections/{id}/recipes/{recipeId}` — remove a recipe from a collection. */
export function useRemoveRecipeFromCollection() {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (vars: { id: string; recipeId: string }) =>
            client.removeRecipeFromCollection(vars.id, vars.recipeId),
        onSuccess: (_result, vars) => {
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.collection(vars.id) });
        },
    });
}
