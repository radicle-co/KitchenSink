// @vitest-environment jsdom
/**
 * What BOTH platforms' My recipes screens hand `RecipeListResults`, and the presentation they decide it from. Moved
 * here from the two hosts' duplicated `SettledRecipeList` prop map and view-mode block (web `RecipeListContainer`,
 * mobile `RecipeListScreen`); the hosts' suites still pin that each renders it.
 *
 * jsdom has no measured `<main>`, so the container class is `narrow` (the server-render value): a list by default,
 * chips scrolling on one line.
 */
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { makeRecipe } from '../../__fixtures__/index.js';
import type { LibraryQuery } from '../useRecipeLibrary.js';
import { useRecipeListPresentation } from '../useRecipeListPresentation.js';
import { useSettledRecipeList, type SettledRecipeListInput } from '../useSettledRecipeList.js';

const lamb = makeRecipe({ id: 'a', title: 'Lamb Tagine', cuisine: 'Moroccan' });
const pasta = makeRecipe({ id: 'b', title: 'Lemon Pasta', cuisine: 'Italian' });

const query: LibraryQuery = {
    data: { pages: [{ data: [lamb] }, { data: [pasta] }] },
    hasNextPage: false,
    isFetchingNextPage: false,
    isFetchNextPageError: false,
    fetchNextPage: vi.fn(async () => undefined),
};

function inputOf(over: Partial<SettledRecipeListInput> = {}): SettledRecipeListInput {
    return {
        query,
        locale: 'en',
        controls: {
            searchValue: '',
            onClearSearch: vi.fn(),
            activeFacets: [],
            onActiveFacetsChange: vi.fn(),
            sort: 'updatedAt',
            onSortChange: vi.fn(),
        },
        presentation: { viewMode: 'list', variant: 'row', chipOverflow: 'scroll' },
        onViewModeChange: vi.fn(),
        onSelectRecipe: vi.fn(),
        onCreateRecipe: vi.fn(),
        onPasteIngredients: vi.fn(),
        refreshNotice: undefined,
        ...over,
    };
}

describe('useRecipeListPresentation', () => {
    it('defaults a narrow container to a list of rows with one scrolling chip line', () => {
        const { result } = renderHook(() => useRecipeListPresentation(undefined));

        expect(result.current).toEqual({ viewMode: 'list', variant: 'row', chipOverflow: 'scroll' });
    });

    it('honours the cook’s stored choice over the width’s default', () => {
        const { result } = renderHook(() => useRecipeListPresentation('grid'));

        expect(result.current).toEqual({ viewMode: 'grid', variant: 'grid', chipOverflow: 'scroll' });
    });
});

describe('useSettledRecipeList', () => {
    it('hands the results the narrowed rows, the chips over the WHOLE library and the viewer’s controls', () => {
        const input = inputOf();
        const { result } = renderHook(() => useSettledRecipeList(input));
        const { results } = result.current;

        expect(results.recipes.map((recipe) => recipe.id)).toEqual(['a', 'b']);
        expect(results.searchValue).toBe('');
        expect(results.onClearSearch).toBe(input.controls.onClearSearch);
        expect(results.sort).toEqual({ value: 'updatedAt', onChange: input.controls.onSortChange });
        expect(results.view).toEqual({ mode: 'list', onChange: input.onViewModeChange });
        expect(results.variant).toBe('row');
        expect(results.chipOverflow).toBe('scroll');
        expect(results.onSelectRecipe).toBe(input.onSelectRecipe);
        expect(results.onCreateRecipe).toBe(input.onCreateRecipe);
        expect(results.onPasteIngredients).toBe(input.onPasteIngredients);
        expect(results.facets.facets.length).toBeGreaterThan(0);
    });

    it('narrows by the search term while the nutrition chunks stay keyed by the LOADED chunks, not the rows', () => {
        const { result } = renderHook(() =>
            useSettledRecipeList(inputOf({ controls: { ...inputOf().controls, searchValue: 'lamb' } })),
        );

        expect(result.current.results.recipes.map((recipe) => recipe.id)).toEqual(['a']);
        expect(result.current.chunkIds).toEqual([['a'], ['b']]);
    });

    it('forwards the refresh notice untouched, and leaves the platform-only props to the host', () => {
        const refreshNotice = { kind: 'failed' as const, onRetry: vi.fn() };
        const { result } = renderHook(() =>
            useSettledRecipeList(inputOf({ refreshNotice } as unknown as Partial<SettledRecipeListInput>)),
        );

        expect(result.current.results.refreshNotice).toBe(refreshNotice);
        expect(result.current.results).not.toHaveProperty('hrefOf');
        expect(result.current.results).not.toHaveProperty('renderNutrition');
        expect(result.current.results).not.toHaveProperty('refresh');
        expect(result.current.results).not.toHaveProperty('scrollBind');
    });
});
