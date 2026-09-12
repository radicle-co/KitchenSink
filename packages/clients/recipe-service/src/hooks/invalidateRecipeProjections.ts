import { useQueryClient } from '@tanstack/react-query';

import { recipeProjections } from '../queries.js';

// A write that changes exactly ONE recipe's projected data (not its membership in other rows) stales three
// regions and no more: that recipe's own subtree (`recipe(id)` — detail + versions + photos), every recipe
// LIST (`recipeLists` — its rows render the same projection), and the SEARCH namespace (`recipeSearches` —
// a search row embeds the full `Recipe`). It is keyed off the mutation's variables, so a sibling recipe's
// detail stays cached. `recipeSearches` is ALWAYS a separate, explicit call: search lives under the
// `search` namespace OUTSIDE the `recipes` prefix (a prior class of staleness bugs), so no `recipes`
// invalidation reaches it by accident. Both rating writes and all three photo writes share this exact set —
// each changes a DIFFERENT projected field (`averageRating`/`ratingCount`, `coverPhotoUrl` respectively),
// but every one of those fields renders on the detail, on every list row, AND on every search result.
// `useRestoreRecipeVersion` changes a DIFFERENT projected field too (title/`currentVersion`) but is DA3
// write-through: its response fully describes the detail, so it writes that through instead of invalidating
// the subtree,
// and invalidates only `recipeVersions(id)` (not covered by the response) plus lists/search/collections.

/**
 * Invalidate the caches that render a single recipe's projected data: its own subtree (`recipe(id)`), every
 * recipe list (`recipeLists`), the recipe-search namespace (`recipeSearches`), and — DA2 — every collection
 * (`collections`, since a `CollectionWithRecipes.recipes` entry embeds the full `Recipe` projection, and the
 * client has no index of which collections embed this recipe). Sibling recipes stay cached. See the block
 * comment above for why these four — and only these four — go stale together.
 *
 * P5: this is now a thin loop over {@link recipeProjections}, the single registry the factories and this
 * invalidation call site both read off — they cannot drift apart.
 *
 * @param queryClient - The query client whose cache to invalidate.
 * @param recipeId - The recipe whose detail/list/search/collection-embed projections changed.
 * @sideEffect Marks the four regions stale on the query cache.
 */
export function invalidateRecipeProjections(queryClient: ReturnType<typeof useQueryClient>, recipeId: string): void {
    for (const queryKey of recipeProjections(recipeId)) {
        void queryClient.invalidateQueries({ queryKey });
    }
}
