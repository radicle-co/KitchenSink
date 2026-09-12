/**
 * Tests for {@link useBrowseRailsRefresh} — the rails block's ONE refresh read over the three rails' caches.
 *
 * Each rail reads through its own suspense boundary, so this hook only OBSERVES: it must never send a rail search of its
 * own, it must report a failed refresh of ANY rail (the last as surely as the first), and its refetch must refresh all
 * three and succeed only when all three do. Replaces the retired `useBrowseRails`, whose per-rail status the boundaries
 * now own.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { RecipeSearchSortBy } from '@kitchensink/recipe-core';
import { recipeQueries, type RecipeServiceClient } from '@kitchensink/recipe-service-client';
import { RecipeServiceProvider } from '@kitchensink/recipe-service-client/hooks';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { RECIPE_BROWSE_RAILS, browseRailSearchParams, type RecipeBrowseRailDefinition } from '../../discovery/model.js';
import { useBrowseRailsRefresh } from '../useBrowseRailsRefresh.js';

/** A settled one-card search page. */
function page() {
    return {
        results: [],
        total: 0,
        page: 1,
        pageSize: 12,
        hasMore: false,
        facets: { dietaryFlags: [], tags: [], cuisine: [], totalTime: [] },
    };
}

/** Render the hook over a cache in which the given rails (every rail, by default) have already settled. */
function renderRefresh(seeded: readonly RecipeBrowseRailDefinition[] = RECIPE_BROWSE_RAILS) {
    const client: RecipeServiceClient = createFakeRecipeServiceClient();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    for (const rail of seeded) {
        queryClient.setQueryData(recipeQueries(client).searchInfinite(browseRailSearchParams(rail)).queryKey, {
            pages: [page()],
            pageParams: [1],
        });
    }

    const search = vi.spyOn(client, 'searchRecipes').mockResolvedValue(page());
    const wrapper = ({ children }: { readonly children: ReactNode }) =>
        createElement(
            QueryClientProvider,
            { client: queryClient },
            createElement(RecipeServiceProvider, { client, children }),
        );

    return { ...renderHook(() => useBrowseRailsRefresh(), { wrapper }), search };
}

describe('useBrowseRailsRefresh', () => {
    it('observes without fetching: nothing refreshing, nothing failed, and no search sent — even for an empty rail', async () => {
        // The last rail has not loaded (its boundary is still pending): an ACTIVE observer would start that search.
        const { result, search } = renderRefresh(RECIPE_BROWSE_RAILS.slice(0, 2));

        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 20));
        });

        expect(result.current.isRefetching).toBe(false);
        expect(result.current.isRefetchError).toBe(false);
        expect(search).not.toHaveBeenCalled();
    });

    it('refreshes all three rails from one refetch, and succeeds when all three do', async () => {
        const { result, search } = renderRefresh();

        let outcome: { readonly isSuccess: boolean } | undefined;
        await act(async () => {
            outcome = await result.current.refetch();
        });

        expect(outcome).toEqual({ isSuccess: true });
        expect(search.mock.calls.map(([params]) => params?.sortBy)).toEqual(
            RECIPE_BROWSE_RAILS.map((rail) => rail.sortBy),
        );
    });

    it('⛔ reports a failed refresh when only the LAST rail fails, and the refetch does not succeed', async () => {
        const { result, search } = renderRefresh();
        search.mockImplementation(async (params) => {
            if (params?.sortBy === RecipeSearchSortBy.QUICKEST) {
                throw new Error('down');
            }

            return page();
        });

        let outcome: { readonly isSuccess: boolean } | undefined;
        await act(async () => {
            outcome = await result.current.refetch();
        });

        expect(outcome).toEqual({ isSuccess: false });
        await waitFor(() => expect(result.current.isRefetchError).toBe(true));
    });

    it('reports refreshing while any rail refreshes', async () => {
        const { result, search } = renderRefresh();
        search.mockReturnValue(new Promise(() => {}));

        act(() => {
            void result.current.refetch();
        });

        await waitFor(() => expect(result.current.isRefetching).toBe(true));
    });
});
