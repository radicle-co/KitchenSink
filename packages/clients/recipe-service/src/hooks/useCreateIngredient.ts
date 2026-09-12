import { useMutation } from '@tanstack/react-query';

import { useRecipeServiceClient } from './recipeServiceProvider.js';

/** `POST /api/v1/ingredients` — create a freeform ingredient. */
export function useCreateIngredient() {
    const client = useRecipeServiceClient();

    return useMutation({
        mutationFn: (name: string) => client.createIngredient(name),
    });
}
