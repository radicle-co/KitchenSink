// @vitest-environment jsdom
/**
 * The library's controls both platforms keep above the suspense boundary: the search term, the chips, the sort and the
 * read they key (`docs/architecture/uiOverhaulBlueprint.md` A11). Moved here from the two containers' duplicated state
 * (UI consolidation S6).
 */
import { RecipeServiceProvider } from '@kitchensink/recipe-service-client/hooks';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import { recipeServiceKeys } from '@kitchensink/recipe-service-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import { RECENT_RECIPE_LIMIT } from '../../widget/recentRecipeLimit.js';
import { useRecipeLibraryControls } from '../useRecipeLibraryControls.js';

const serviceClient = createFakeRecipeServiceClient();
let queryClient = new QueryClient();
const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
        <RecipeServiceProvider client={serviceClient}>{children}</RecipeServiceProvider>
    </QueryClientProvider>
);
const chunk = (total: number) => ({ pages: [{ data: [], total, hasMore: false, nextFirstPage: 2 }], pageParams: [1] });
const LIBRARY = recipeServiceKeys.recipeLibrary({ sortBy: 'updatedAt' });

beforeEach(() => {
    queryClient = new QueryClient();
});

describe('useRecipeLibraryControls', () => {
    it('starts empty, sorted by last edit', () => {
        const { result } = renderHook(() => useRecipeLibraryControls(), { wrapper });

        expect(result.current).toMatchObject({ searchValue: '', activeFacets: [], sort: 'updatedAt' });
    });

    it('shows the search while nothing is cached (unknown is not empty)', () => {
        const { result } = renderHook(() => useRecipeLibraryControls(), { wrapper });

        expect(result.current.searchVisible).toBe(true);
    });

    it('clears the search term', () => {
        const { result } = renderHook(() => useRecipeLibraryControls(), { wrapper });

        act(() => result.current.onSearchChange('lamb'));
        expect(result.current.searchValue).toBe('lamb');
        act(() => result.current.onClearSearch());
        expect(result.current.searchValue).toBe('');
    });

    it('reads the library under the sort, and a new sort is a new key', () => {
        const { result } = renderHook(() => useRecipeLibraryControls(), { wrapper });
        const first = result.current.read.queryKey;

        act(() => result.current.onSortChange('title'));

        expect(result.current.sort).toBe('title');
        expect(result.current.read.queryKey).not.toEqual(first);
    });

    it('keeps one read object across renders that change nothing it keys on', () => {
        const { result, rerender } = renderHook(() => useRecipeLibraryControls(), { wrapper });
        const read = result.current.read;

        rerender();
        act(() => result.current.onSearchChange('x'));

        expect(result.current.read).toBe(read);
    });

    // The floating create button (§3.4) on My recipes, in the six states. The search hides only on the first run (§4.3).
    describe('the floating create button and the search, by the library`s state', () => {
        const run = () => renderHook(() => useRecipeLibraryControls(), { wrapper }).result;

        it('loading: the button yields (it never appears), and the search stays', () => {
            const result = run();

            expect(result.current).toMatchObject({ createEntryYields: true, searchVisible: true });
        });

        it('populated: the button shows', () => {
            queryClient.setQueryData(LIBRARY, chunk(3));

            expect(run().current).toMatchObject({ createEntryYields: false, searchVisible: true });
        });

        it('warm and empty (first run): the button yields and the search hides', () => {
            queryClient.setQueryData(LIBRARY, chunk(0));

            expect(run().current).toMatchObject({ createEntryYields: true, searchVisible: false });
        });

        it('a typed search keeps the search visible on an empty library, and keeps the button (a no-match has no CTA)', async () => {
            queryClient.setQueryData(LIBRARY, chunk(0));
            const result = run();

            act(() => result.current.onSearchChange('lamb'));

            await waitFor(() =>
                expect(result.current).toMatchObject({ createEntryYields: false, searchVisible: true }),
            );
        });

        it('a pressed chip keeps the button on an empty library, as the narrowed rule says', () => {
            queryClient.setQueryData(LIBRARY, chunk(0));
            const result = run();

            act(() => result.current.onActiveFacetsChange(['vegan']));

            expect(result.current.createEntryYields).toBe(false);
        });

        it('offline (paused, nothing cached): the button shows', () => {
            queryClient.getQueryCache().build(queryClient, { queryKey: LIBRARY }).setState({ fetchStatus: 'paused' });

            expect(run().current.createEntryYields).toBe(false);
        });

        it('load error (nothing cached): the button shows', () => {
            queryClient
                .getQueryCache()
                .build(queryClient, { queryKey: LIBRARY })
                .setState({ status: 'error', fetchStatus: 'idle', error: new Error('503') });

            expect(run().current.createEntryYields).toBe(false);
        });

        it('a sort change does not blink: the other sort`s settled read keeps the button while the new key loads', () => {
            queryClient.setQueryData(LIBRARY, chunk(3));
            const result = run();

            act(() => result.current.onSortChange('title'));

            expect(result.current.createEntryYields).toBe(false);
        });

        it('Home`s recent page settling empty judges My recipes before its own read does', () => {
            queryClient.setQueryData(recipeServiceKeys.recipeList({ pageSize: RECENT_RECIPE_LIMIT }), {
                data: [],
                total: 0,
                page: 1,
                pageSize: RECENT_RECIPE_LIMIT,
                hasMore: false,
            });

            expect(run().current).toMatchObject({ createEntryYields: true, searchVisible: false });
        });
    });
});
