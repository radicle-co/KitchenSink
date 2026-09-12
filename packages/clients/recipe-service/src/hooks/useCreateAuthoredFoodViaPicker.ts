import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { CreateAuthoredFoodViaPickerRequest } from '@kitchensink/schema-recipe';

import { recipeServiceKeys } from '../queries.js';
import { useRecipeServiceClient } from './recipeServiceProvider.js';

/**
 * `POST /api/v1/ingredients/authored-food` (plan U16) — the picker's create-and-attach mutation.
 *
 * Invalidation matches `useAddIngredientByFood`: on a `created` outcome the author's own typeahead
 * must now offer the new food in the familiar `local` section, so the shared search prefix is staled. A
 * `duplicate` outcome created nothing, and the cache is left alone — the reuse affordance re-uses the
 * by-food mutation, which carries its own invalidation.
 */
export function useCreateAuthoredFoodViaPicker() {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (input: CreateAuthoredFoodViaPickerRequest) => client.createAuthoredFoodViaPicker(input),
        onSuccess: (outcome) => {
            if (outcome.created) {
                void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.ingredientSearches });
            }
        },
    });
}
