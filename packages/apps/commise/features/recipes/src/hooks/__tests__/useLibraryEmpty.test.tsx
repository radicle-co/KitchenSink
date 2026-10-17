// @vitest-environment jsdom
/**
 * Whether the cached library read has settled empty — what My recipes' frame reads to hide the search on the first run
 * (`docs/design/uiOverhaul/buildSpec.md` §4.3). It only READS the cache: it never fetches, so it cannot add a request
 * beside the suspense read (a disabled observer of the same key did, on every boundary reset).
 */
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { act, render as renderTree, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useLibraryEmpty } from '../useLibraryEmpty.js';

const KEY = ['recipe-service', 'recipes', 'list', 'library', {}] as const;

function harness() {
    const client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    return { client, render: () => renderHook(() => useLibraryEmpty(KEY), { wrapper }) };
}

const chunk = (total: number) => ({ pages: [{ data: [], total, hasMore: false, nextFirstPage: 2 }], pageParams: [1] });

describe('useLibraryEmpty', () => {
    it('is false while nothing is cached (unknown is not empty)', () => {
        expect(harness().render().result.current).toBe(false);
    });

    // ⚠️ REWRITTEN to wait: the hook hears the cache on TanStack's notify schedule, after the write, not inside it (the
    // case below is why), so a change reaches it a tick later.
    it('follows the cache: true for a settled empty library, false once it holds a recipe', async () => {
        const { client, render } = harness();
        const { result } = render();

        act(() => {
            client.setQueryData(KEY, chunk(0));
        });
        await waitFor(() => expect(result.current).toBe(true));

        act(() => {
            client.setQueryData(KEY, chunk(3));
        });
        await waitFor(() => expect(result.current).toBe(false));
    });

    // A suspense read writes the cache while its component RENDERS. A listener that re-rendered the host there was a
    // setState in another component's render — measured on the device as React's "Cannot update a component
    // (`CollectionsScreen`) while rendering a different component (`SettledCollections`)", once per visit.
    it('never updates its host while another component renders a cache write', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const client = new QueryClient();

        const Writer = () => {
            useQueryClient().setQueryData(KEY, chunk(0));

            return null;
        };

        const Host = ({ children }: { children: ReactNode }) => (
            <>
                {String(useLibraryEmpty(KEY))}
                {children}
            </>
        );

        const tree = (writing: boolean) => (
            <QueryClientProvider client={client}>
                <Host>{writing ? <Writer /> : null}</Host>
            </QueryClientProvider>
        );
        // The host subscribes when it commits; the write comes in a LATER render, as the suspense read's does.
        const view = renderTree(tree(false));
        view.rerender(tree(true));

        await waitFor(() => expect(view.container.textContent).toBe('true'));
        expect(error.mock.calls.flat().join('\n')).not.toMatch(/Cannot update a component/);
        error.mockRestore();
    });

    // Home's recent-recipes read is ONE flat page (`recipeQueries.list`), not chunks: the same paginated envelope, so
    // its `total` says the same thing (the floating create button hides for Home's first run, §3.4).
    it('reads a flat page too: true for a settled page of no recipes, false once one exists', async () => {
        const { client, render } = harness();
        const { result } = render();

        act(() => {
            client.setQueryData(KEY, { data: [], total: 0, page: 1, pageSize: 4, hasMore: false });
        });
        await waitFor(() => expect(result.current).toBe(true));

        act(() => {
            client.setQueryData(KEY, { data: [], total: 2, page: 1, pageSize: 4, hasMore: false });
        });
        await waitFor(() => expect(result.current).toBe(false));
    });

    it('never fetches', () => {
        const { client, render } = harness();
        render();

        expect(client.getQueryCache().find({ queryKey: KEY })).toBeUndefined();
    });
});
