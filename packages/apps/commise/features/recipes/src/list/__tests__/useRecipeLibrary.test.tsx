// @vitest-environment jsdom
/**
 * The settled library's shared view-model: what BOTH platforms' My recipes screens derive from the loaded chunks
 * (`docs/architecture/uiOverhaulBlueprint.md` A11). Moved here from the two containers' duplicated `SettledRecipeList`
 * (UI consolidation S6); the containers' own suites still pin that each renders it.
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { makeRecipe } from '../../__fixtures__/index.js';
import { useRecipeLibrary, type LibraryQuery } from '../useRecipeLibrary.js';

const lamb = makeRecipe({ id: 'a', title: 'Lamb Tagine', cuisine: 'Moroccan', totalTimeMinutes: 200 });
const pasta = makeRecipe({ id: 'b', title: 'Lemon Pasta', cuisine: 'Italian', totalTimeMinutes: 20 });
const kofta = makeRecipe({ id: 'c', title: 'Lamb Kofta', cuisine: 'Moroccan', totalTimeMinutes: 25 });

const queryOf = (overrides: Partial<LibraryQuery> = {}): LibraryQuery => ({
    data: { pages: [{ data: [lamb, pasta] }, { data: [kofta] }] },
    hasNextPage: true,
    isFetchingNextPage: false,
    isFetchNextPageError: false,
    fetchNextPage: vi.fn(async () => undefined),
    ...overrides,
});

const render = (over: { searchValue?: string; activeFacets?: readonly string[]; query?: LibraryQuery } = {}) => {
    const onActiveFacetsChange = vi.fn();
    const hook = renderHook(
        (props: { searchValue: string; activeFacets: readonly string[] }) =>
            useRecipeLibrary({
                query: over.query ?? queryOf(),
                locale: 'en',
                onActiveFacetsChange,
                ...props,
            }),
        { initialProps: { searchValue: over.searchValue ?? '', activeFacets: over.activeFacets ?? [] } },
    );

    return { ...hook, onActiveFacetsChange };
};

type Updater = (current: readonly string[]) => readonly string[];

const updaterAt = (calls: readonly (readonly unknown[])[], index: number): Updater => {
    const updater = calls[index]?.[0];

    if (typeof updater !== 'function') {
        throw new Error(`call ${index} was not given an updater`);
    }

    return updater as Updater;
};

describe('useRecipeLibrary', () => {
    it('flattens every loaded chunk into the rows, not just the first page', () => {
        expect(render().result.current.recipes.map((recipe) => recipe.id)).toEqual(['a', 'b', 'c']);
    });

    it('narrows by the search term and reports the state it leaves', () => {
        const { result } = render({ searchValue: 'lamb' });

        expect(result.current.recipes.map((recipe) => recipe.id)).toEqual(['a', 'c']);
        expect(result.current.state).toBe('results');
    });

    it('names a no-match by what narrowed it', () => {
        expect(render({ searchValue: 'zzz' }).result.current.state).toBe('noMatchQuery');
        expect(render({ activeFacets: ['Italian'], searchValue: 'lamb' }).result.current.state).toBe('noMatchBoth');
    });

    it('counts chips over the WHOLE library beside the search', () => {
        const { result } = render({ searchValue: 'lamb' });
        const moroccan = result.current.facets.facets.find((facet) => facet.value === 'Moroccan');

        expect(moroccan).toMatchObject({ count: 2, selected: false });
    });

    it('toggles a chip on and off through the functional updater', () => {
        const { result, onActiveFacetsChange } = render();

        result.current.facets.onToggle('Italian');
        const toggle = updaterAt(onActiveFacetsChange.mock.calls, 0);

        expect(toggle([])).toEqual(['Italian']);
        expect(toggle(['Italian', 'x'])).toEqual(['x']);
    });

    it('clears every chip, and counts a Clear-filters press so the heading can take focus', () => {
        const { result, onActiveFacetsChange } = render({ activeFacets: ['Italian'] });

        expect(result.current.clearCount).toBe(0);
        act(() => {
            result.current.onClearFilters();
        });

        expect(result.current.clearCount).toBe(1);
        expect(updaterAt(onActiveFacetsChange.mock.calls, 0)(['x'])).toEqual([]);

        result.current.facets.onClear();
        expect(updaterAt(onActiveFacetsChange.mock.calls, 1)(['x'])).toEqual([]);
    });

    it('keys the calorie batches by the LOADED chunks, unchanged by the narrowing', () => {
        const wide = render().result.current.chunkIds;
        const narrow = render({ searchValue: 'lamb' }).result.current.chunkIds;

        expect(wide).toEqual([['a', 'b'], ['c']]);
        expect(narrow).toEqual(wide);
    });

    it('forwards the next-page flags and fetches the next chunk on demand', () => {
        const query = queryOf({ isFetchingNextPage: true, isFetchNextPageError: true });
        const { result } = render({ query });

        expect(result.current.loadMore).toMatchObject({ hasMore: true, loading: true, failed: true });
        result.current.loadMore.onLoadMore();
        expect(query.fetchNextPage).toHaveBeenCalledTimes(1);
    });
});
