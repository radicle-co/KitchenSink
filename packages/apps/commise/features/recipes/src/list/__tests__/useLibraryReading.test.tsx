// @vitest-environment jsdom
/**
 * The non-suspending library read. A NEW SORT is a new query key; without placeholder data it would flip the list
 * back to `pending` (and the header with it) every time the cook changes the sort, which the suspense version hid
 * behind `useDeferredValue`. The previous library stays on screen until the new order lands.
 */
import { RecipeServiceProvider } from '@kitchensink/recipe-service-client/hooks';
import { recipeQueries, recipeServiceKeys } from '@kitchensink/recipe-service-client';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useLibraryReading } from '../useLibraryReading.js';

const client = createFakeRecipeServiceClient();
let queryClient = new QueryClient();
const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
        <RecipeServiceProvider client={client}>{children}</RecipeServiceProvider>
    </QueryClientProvider>
);
const chunk = { pages: [{ data: [], total: 0, hasMore: false, nextFirstPage: 2 }], pageParams: [1] };

beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.spyOn(client, 'listRecipes').mockReturnValue(new Promise(() => {}));
});

describe('useLibraryReading', () => {
    it('is pending while nothing is cached', () => {
        const { result } = renderHook(() => useLibraryReading(recipeQueries(client).library({ sortBy: 'updatedAt' })), {
            wrapper,
        });

        expect(result.current.reading.kind).toBe('pending');
    });

    it('is settled from the cache with no fetch needed to render', () => {
        queryClient.setQueryData(recipeServiceKeys.recipeLibrary({ sortBy: 'updatedAt' }), chunk as never);
        const { result } = renderHook(() => useLibraryReading(recipeQueries(client).library({ sortBy: 'updatedAt' })), {
            wrapper,
        });

        expect(result.current.reading.kind).toBe('settled');
    });

    it('keeps the previous library on screen while a changed sort is pending', () => {
        queryClient.setQueryData(recipeServiceKeys.recipeLibrary({ sortBy: 'updatedAt' }), chunk as never);
        const { result, rerender } = renderHook(
            ({ sortBy }: { sortBy: 'updatedAt' | 'title' }) =>
                useLibraryReading(recipeQueries(client).library({ sortBy })),
            { wrapper, initialProps: { sortBy: 'updatedAt' } },
        );

        rerender({ sortBy: 'title' });

        expect(result.current.reading.kind).toBe('settled');
    });
});
