import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { RecipeDetail } from '@kitchensink/recipe-core';
import type { SetRatingRequest } from '@kitchensink/schema-recipe';

import { recipeServiceKeys } from '../queries.js';
import { invalidateRecipeProjections } from './invalidateRecipeProjections.js';
import type { RatingMutationContext } from './ratingMutationContext.js';
import { useRecipeServiceClient } from './recipeServiceProvider.js';

/** `PUT /api/v1/recipes/{id}/rating` — set the caller's rating (idempotent upsert), optimistically (DA4). */
export function useSetRecipeRating() {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (vars: { id: string; input: SetRatingRequest }) => client.setRecipeRating(vars.id, vars.input),
        onMutate: async (vars): Promise<RatingMutationContext> => {
            await queryClient.cancelQueries({ queryKey: recipeServiceKeys.recipe(vars.id) });
            const previous = queryClient.getQueryData<RecipeDetail>(recipeServiceKeys.recipe(vars.id));
            queryClient.setQueryData<RecipeDetail>(recipeServiceKeys.recipe(vars.id), (old) =>
                old ? { ...old, viewerRating: vars.input.stars } : old,
            );

            return { previous };
        },
        onError: (_error, vars, context) => {
            if (context?.previous !== undefined) {
                queryClient.setQueryData(recipeServiceKeys.recipe(vars.id), context.previous);
            }
        },
        onSuccess: (_data, vars) => {
            invalidateRecipeProjections(queryClient, vars.id);
        },
    });
}
