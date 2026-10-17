import { useQueryClient } from '@tanstack/react-query';

import { recipeServiceKeys } from '../queries.js';

/**
 * Invalidate every cached collection (DA10-b) — the `collections` prefix (list + every detail). Symmetric
 * with `invalidateRecipeProjections`: a single-purpose thin wrapper so every collection-mutation hook
 * that stales ONLY the collections namespace (create/update/delete/clone/pull-from-source) delegates to one
 * call site instead of repeating the literal `invalidateQueries({ queryKey: recipeServiceKeys.collections })`
 * inline. Composite invalidations that stale `collections` ALONGSIDE recipe regions (e.g. `useUpdateRecipe`,
 * `useSetRecipeVisibility`, `useRestoreRecipeVersion`, `invalidateEditedRecipeRows`) are DELIBERATELY left
 * as their own explicit calls — DA2's block comment in `invalidateRecipeProjections.ts` documents that
 * specific 3/4-key set as a single reasoned unit, and folding `collections` out of it into this helper would
 * obscure that unit, not DRY it.
 *
 * On the public barrel (unlike `invalidateRecipeProjections`, module-exported but not public) so it is
 * unit-testable directly against a bare `QueryClient`, without rendering a mutation hook — its own contract
 * (which keys go stale) is simple
 * enough to pin on its own, on top of the observable-outcome coverage every delegating hook keeps.
 *
 * @param queryClient - The query client whose cache to invalidate.
 * @sideEffect Marks the `collections` region stale on the query cache.
 */
export function invalidateCollections(queryClient: ReturnType<typeof useQueryClient>): void {
    void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.collections });
}
