import { useInfiniteQuery } from '@tanstack/react-query';
import { useEffect } from 'react';

import { recipeQueries } from '../queries.js';
import { useRecipeServiceClient } from './recipeServiceProvider.js';

/** Page size for {@link useAllOwnerRecipes}' underlying list calls — bulk pages, not a render page. */
export const ALL_OWNER_RECIPES_PAGE_SIZE = 100;

/**
 * `GET /api/v1/recipes` — the caller's ENTIRE recipe list, eagerly paged to completion.
 *
 * The account-erasure donate election (CR-002 / U4b) is the input to an IRREVERSIBLE action: any owner-only
 * recipe the user is never shown would be silently destroyed. So the election MUST see every page, not just
 * the first — a fixed `pageSize` cap (the trap this replaces) drops recipe N+1 onward. This drives
 * `recipeQueries().listInfinite` to exhaustion — on each render, if another page exists and none is in
 * flight, it fetches the next — and reports `isLoading` (and withholds `isComplete`) until the final page is
 * in, so a caller never presents a partial set as the full donatable list.
 *
 * The `useEffect` is an external-system sync (driving TanStack Query's pager to completion), not initial
 * data fetch — the query owns the fetch; the effect only advances the cursor.
 *
 * **A FAILURE ends the wait.** `isLoading` ORs in `hasNextPage`, which is derived from pagination metadata,
 * not from fetch state: when a page after the first fails, no page is appended, so `hasNextPage` stays true
 * forever and the composite `isLoading` latched true permanently. Both erasure surfaces branch
 * `recipesLoading ? … : recipesError ? …`, so that made the error branch unreachable and the donate election
 * spun with no retry. `failed` therefore gates BOTH the pager (never re-issue a fetch that just failed) and
 * `isLoading` (a settled failure is not a wait), and it folds `isFetchNextPageError` into `isError` so a
 * mid-pager failure is as visible as an initial one.
 *
 * @param pageSize - Page size for the underlying list calls (default {@link ALL_OWNER_RECIPES_PAGE_SIZE}).
 * @returns The flattened recipes plus `isLoading` (true until fully paged), `isError`, and `isComplete`.
 */
export function useAllOwnerRecipes(pageSize = ALL_OWNER_RECIPES_PAGE_SIZE) {
    const client = useRecipeServiceClient();
    const query = useInfiniteQuery(recipeQueries(client).listInfinite({ pageSize }));
    const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
    const failed = query.isError || query.isFetchNextPageError;

    useEffect(() => {
        if (hasNextPage && !isFetchingNextPage && !failed) {
            void fetchNextPage();
        }
    }, [hasNextPage, isFetchingNextPage, fetchNextPage, failed]);

    const recipes = query.data?.pages.flatMap((page) => page.data) ?? [];

    return {
        recipes,
        // Until the last page lands there is still a page owed → the election is INCOMPLETE. Surface as
        // loading and withhold isComplete so no caller treats a partial set as the full list. A failure is
        // NOT a wait: once the pager has failed, the caller must see the error branch, not a spinner.
        isLoading: !failed && (query.isLoading || isFetchingNextPage || hasNextPage),
        isError: failed,
        isComplete: query.isSuccess && !hasNextPage && !failed,
    };
}
