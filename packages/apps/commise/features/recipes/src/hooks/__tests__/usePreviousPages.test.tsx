/**
 * Tests for {@link usePreviousPages} — the results kept under a failed search — and {@link useRailRetries} — the
 * per-rail Try again counters. Both used to be copied byte-for-byte into the web container and the mobile screen; this is
 * their one suite.
 */
import { RecipeSearchSortBy } from '@kitchensink/recipe-core';
import { recipeQueries, type RecipeServiceClient } from '@kitchensink/recipe-service-client';
import { RecipeServiceProvider } from '@kitchensink/recipe-service-client/hooks';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { discoverySearchParams, type RecipeDiscoveryCriteria } from '../../discovery/model.js';
import { usePreviousPages } from '../usePreviousPages.js';
import { useRailRetries } from '../useRailRetries.js';

const CRITERIA: RecipeDiscoveryCriteria = {
    filters: {},
    query: 'soup',
    sortBy: RecipeSearchSortBy.RELEVANCE,
    browseDismissed: false,
};

/** The criteria the hook falls back to while nothing has settled. */
const FALLBACK: RecipeDiscoveryCriteria = { ...CRITERIA, query: '' };

const PAGE = {
    results: [],
    total: 0,
    page: 1,
    pageSize: 12,
    hasMore: false,
    facets: { dietaryFlags: [], tags: [], cuisine: [], totalTime: [] },
};

/** Render the hook over a cache in which `seeded` criteria have a settled read. */
function renderPrevious(criteria: RecipeDiscoveryCriteria | undefined, seeded: readonly RecipeDiscoveryCriteria[]) {
    const client: RecipeServiceClient = createFakeRecipeServiceClient();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    for (const seed of seeded) {
        queryClient.setQueryData(recipeQueries(client).searchInfinite(discoverySearchParams(seed)).queryKey, {
            pages: [PAGE],
            pageParams: [1],
        });
    }

    const search = vi.spyOn(client, 'searchRecipes').mockResolvedValue(PAGE);
    const wrapper = ({ children }: { readonly children: ReactNode }) =>
        createElement(
            QueryClientProvider,
            { client: queryClient },
            createElement(RecipeServiceProvider, { client, children }),
        );
    const view = renderHook(() => usePreviousPages(client, criteria), { wrapper });

    return { ...view, search };
}

describe('usePreviousPages', () => {
    it('answers the pages the last settled criteria left in the cache', () => {
        const { result } = renderPrevious(CRITERIA, [CRITERIA]);

        expect(result.current).toEqual([PAGE]);
    });

    it('⛔ answers nothing on a first load, even when the fallback criteria happen to be cached', () => {
        const { result } = renderPrevious(undefined, [FALLBACK]);

        expect(result.current).toBeUndefined();
    });

    it('⛔ reads the cache only: it never sends a search of its own', () => {
        const { search } = renderPrevious(CRITERIA, []);

        expect(search).not.toHaveBeenCalled();
    });
});

describe('useRailRetries', () => {
    it('starts every rail at zero and counts one rail`s Try again without touching the others', () => {
        const { result } = renderHook(() => useRailRetries());

        expect(result.current.retries).toEqual({ trending: 0, new: 0, quick: 0 });

        act(() => {
            result.current.retry('new');
            result.current.retry('new');
        });

        expect(result.current.retries).toEqual({ trending: 0, new: 2, quick: 0 });
    });
});
