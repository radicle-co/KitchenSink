import { useMutation, useQueryClient } from '@tanstack/react-query';

import { recipeServiceKeys } from '../queries.js';
import { useRecipeServiceClient } from './recipeServiceProvider.js';

/**
 * Invalidate the broad set an EDIT to an existing recipe stales, for a mutation whose response does NOT
 * fully describe the entity (`deleteRecipe` resolves `void`, so there is nothing to write through): every
 * recipe query (`recipes`), the recipe-search namespace (`recipeSearches`), and — DA2 — every collection
 * embed (`collections`). Used ONLY by {@link useDeleteRecipe} now — DA3 moved update/visibility/restore to
 * explicit write-through + narrower invalidation (see each hook's doc comment) once their responses proved
 * to fully describe the changed detail.
 *
 * @param queryClient - The query client whose cache to invalidate.
 * @sideEffect Marks the three regions stale on the query cache.
 */
function invalidateEditedRecipeRows(queryClient: ReturnType<typeof useQueryClient>): void {
    void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.recipes });
    void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.recipeSearches });
    void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.collections });
}

/** `DELETE /api/v1/recipes/{id}` — soft-delete a recipe. */
export function useDeleteRecipe() {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (id: string) => client.deleteRecipe(id),
        onSuccess: () => {
            invalidateEditedRecipeRows(queryClient);
        },
    });
}
