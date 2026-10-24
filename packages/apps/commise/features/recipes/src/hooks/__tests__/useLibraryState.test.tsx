// @vitest-environment jsdom
/**
 * The library's state read from the query cache — what the floating create button (Home, My recipes, Collections) and
 * My recipes' search read (`docs/design/uiOverhaul/buildSpec.md` §3.4, §4.3). It only READS the cache: it never
 * fetches, so it cannot add a request beside the suspense read.
 *
 * ⚠️ REWRITTEN from `useLibraryEmpty.test.tsx`, whose hook answered one boolean ("settled empty") and so could not tell
 * loading from offline from failed. Its cases that still hold are kept: it follows the cache, it reads a flat page too,
 * it never fetches, and it never updates its host while another component renders a cache write.
 */
import { recipeServiceKeys } from '@kitchensink/recipe-service-client';
import { QueryClient, QueryClientProvider, onlineManager, useQueryClient } from '@tanstack/react-query';
import { act, render as renderTree, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RECENT_RECIPE_LIMIT } from '../../widget/recentRecipeLimit.js';
import { useLibraryState } from '../useLibraryState.js';
import { useRecipeLibraryState } from '../useRecipeLibraryState.js';

const BY_UPDATED = recipeServiceKeys.recipeLibrary({ sortBy: 'updatedAt' });
const BY_TITLE = recipeServiceKeys.recipeLibrary({ sortBy: 'title' });
const RECENT = recipeServiceKeys.recipeList({ pageSize: RECENT_RECIPE_LIMIT });

const chunk = (total: number) => ({ pages: [{ data: [], total, hasMore: false, nextFirstPage: 2 }], pageParams: [1] });
const page = (total: number) => ({ data: [], total, page: 1, pageSize: 4, hasMore: false });

function harness() {
    const client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    return { client, wrapper };
}

afterEach(() => {
    onlineManager.setOnline(true);
});

describe('useRecipeLibraryState', () => {
    it('loading while nothing is cached, and while the own read is fetching', () => {
        const { client, wrapper } = harness();
        expect(renderHook(() => useRecipeLibraryState(BY_UPDATED), { wrapper }).result.current).toBe('loading');

        client.getQueryCache().build(client, { queryKey: BY_UPDATED }).setState({ fetchStatus: 'fetching' });
        expect(renderHook(() => useRecipeLibraryState(BY_UPDATED), { wrapper }).result.current).toBe('loading');
    });

    it('unreachable while the own read is paused (offline): the button stays', () => {
        const { client, wrapper } = harness();
        client.getQueryCache().build(client, { queryKey: BY_UPDATED }).setState({ fetchStatus: 'paused' });

        expect(renderHook(() => useRecipeLibraryState(BY_UPDATED), { wrapper }).result.current).toBe('unreachable');
    });

    it('unreachable once the own read has failed: the button stays', () => {
        const { client, wrapper } = harness();
        client
            .getQueryCache()
            .build(client, { queryKey: BY_UPDATED })
            .setState({ status: 'error', fetchStatus: 'idle', error: new Error('503') });

        expect(renderHook(() => useRecipeLibraryState(BY_UPDATED), { wrapper }).result.current).toBe('unreachable');
    });

    // ⚠️ REWRITTEN to wait: the hook hears the cache on TanStack's notify schedule, after the write, not inside it.
    it('follows the cache from loading to empty to populated', async () => {
        const { client, wrapper } = harness();
        const { result } = renderHook(() => useRecipeLibraryState(BY_UPDATED), { wrapper });

        act(() => {
            client.setQueryData(BY_UPDATED, chunk(0));
        });
        await waitFor(() => expect(result.current).toBe('empty'));

        act(() => {
            client.setQueryData(BY_UPDATED, chunk(3));
        });
        await waitFor(() => expect(result.current).toBe('populated'));
    });

    it('is warm from the FIRST render: a cached read is judged with no loading frame', () => {
        const { client, wrapper } = harness();
        client.setQueryData(BY_UPDATED, chunk(2));
        const seen: string[] = [];

        renderHook(
            () => {
                const state = useRecipeLibraryState(BY_UPDATED);
                seen.push(state);

                return state;
            },
            { wrapper },
        );

        expect(seen[0]).toBe('populated');
    });

    it('stays populated while a warm read refetches or is paused', () => {
        const { client, wrapper } = harness();
        client.setQueryData(BY_UPDATED, chunk(2));
        const query = client.getQueryCache().find({ queryKey: BY_UPDATED });
        query?.setState({ fetchStatus: 'paused' });

        expect(renderHook(() => useRecipeLibraryState(BY_UPDATED), { wrapper }).result.current).toBe('populated');
    });

    it('a sort change does not blink: the other sort`s settled read judges while the new key loads', () => {
        const { client, wrapper } = harness();
        client.setQueryData(BY_UPDATED, chunk(5));
        client.getQueryCache().build(client, { queryKey: BY_TITLE }).setState({ fetchStatus: 'fetching' });

        expect(renderHook(() => useRecipeLibraryState(BY_TITLE), { wrapper }).result.current).toBe('populated');
    });

    it('Home`s recent page is part of the family: My recipes loading is judged by it', () => {
        const { client, wrapper } = harness();
        client.setQueryData(RECENT, page(0));

        expect(renderHook(() => useRecipeLibraryState(BY_UPDATED), { wrapper }).result.current).toBe('empty');
    });

    it('a recipe list read under any other key (a filtered or narrowed page) does not count', () => {
        const { client, wrapper } = harness();
        client.setQueryData(recipeServiceKeys.recipeList({ pageSize: 1 }), page(9));
        client.setQueryData(recipeServiceKeys.recipeListInfinite({}), chunk(9));

        expect(renderHook(() => useRecipeLibraryState(RECENT), { wrapper }).result.current).toBe('loading');
    });

    // A suspense read writes the cache while its component RENDERS. A listener that re-rendered the host there was a
    // setState in another component's render ("Cannot update a component while rendering a different component").
    it('never updates its host while another component renders a cache write', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const client = new QueryClient();

        const Writer = () => {
            useQueryClient().setQueryData(BY_UPDATED, chunk(0));

            return null;
        };

        const Host = ({ children }: { children: ReactNode }) => (
            <>
                {useRecipeLibraryState(BY_UPDATED)}
                {children}
            </>
        );
        const tree = (writing: boolean) => (
            <QueryClientProvider client={client}>
                <Host>{writing ? <Writer /> : null}</Host>
            </QueryClientProvider>
        );
        const view = renderTree(tree(false));
        view.rerender(tree(true));

        await waitFor(() => expect(view.container.textContent).toBe('empty'));
        expect(error.mock.calls.flat().join('\n')).not.toMatch(/Cannot update a component/);
        error.mockRestore();
    });

    it('never fetches or creates a cache entry', () => {
        const { client, wrapper } = harness();
        renderHook(() => useRecipeLibraryState(BY_UPDATED), { wrapper });

        expect(client.getQueryCache().find({ queryKey: BY_UPDATED })).toBeUndefined();
    });
});

describe('useLibraryState (a family of one: the collection list)', () => {
    const KEY = ['recipe-service', 'collections', 'list', 'infinite', {}] as const;

    it('judges the one key by its own entry', async () => {
        const { client, wrapper } = harness();
        const { result } = renderHook(() => useLibraryState([{ queryKey: KEY, exact: true }], KEY), { wrapper });
        expect(result.current).toBe('loading');

        act(() => {
            client.setQueryData(KEY, chunk(0));
        });
        await waitFor(() => expect(result.current).toBe('empty'));
    });
});
