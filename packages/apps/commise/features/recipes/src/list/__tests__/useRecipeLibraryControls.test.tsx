// @vitest-environment jsdom
/**
 * The library's controls both platforms keep above the suspense boundary: the search term, the chips, the sort and the
 * read they key (`docs/architecture/uiOverhaulBlueprint.md` A11). Moved here from the two containers' duplicated state
 * (UI consolidation S6).
 */
import { RecipeServiceProvider } from '@kitchensink/recipe-service-client/hooks';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { useRecipeLibraryControls } from '../useRecipeLibraryControls.js';

const queryClient = new QueryClient();
const serviceClient = createFakeRecipeServiceClient();
const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
        <RecipeServiceProvider client={serviceClient}>{children}</RecipeServiceProvider>
    </QueryClientProvider>
);

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
});
