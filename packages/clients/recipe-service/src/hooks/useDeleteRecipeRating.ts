import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { RecipeDetail } from '@kitchensink/recipe-core';

import { recipeServiceKeys } from '../queries.js';
import { invalidateRecipeProjections } from './invalidateRecipeProjections.js';
import type { RatingMutationContext } from './ratingMutationContext.js';
import { useRecipeServiceClient } from './recipeServiceProvider.js';

/** `DELETE /api/v1/recipes/{id}/rating` — remove the caller's rating (idempotent), optimistically (DA4). */
export function useDeleteRecipeRating() {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (id: string) => client.deleteRecipeRating(id),
        onMutate: async (id): Promise<RatingMutationContext> => {
            await queryClient.cancelQueries({ queryKey: recipeServiceKeys.recipe(id) });
            const previous = queryClient.getQueryData<RecipeDetail>(recipeServiceKeys.recipe(id));
            queryClient.setQueryData<RecipeDetail>(recipeServiceKeys.recipe(id), (old) =>
                old ? { ...old, viewerRating: undefined } : old,
            );

            return { previous };
        },
        onError: (_error, id, context) => {
            if (context?.previous !== undefined) {
                queryClient.setQueryData(recipeServiceKeys.recipe(id), context.previous);
            }
        },
        onSuccess: (_data, id) => {
            invalidateRecipeProjections(queryClient, id);
        },
    });
}
