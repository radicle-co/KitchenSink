// @vitest-environment jsdom
/**
 * Component tests for {@link ClientQueryBoundary} — the web hydration gate over `QueryBoundary`.
 *
 * A `'use client'` component still renders on the Next server, and a `useSuspenseQuery` read FETCHES during that
 * render. The browser query client's retry policy then retries a server-side auth-not-ready failure for seconds. The
 * gate's whole job is that no read runs until the tree has hydrated, so these tests drive the real
 * `renderToString` → `hydrateRoot` sequence and count the fetches, rather than asserting on the gate's own state.
 */
import { QueryClient, QueryClientProvider, useSuspenseQuery, type QueryKey } from '@tanstack/react-query';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ClientQueryBoundary } from '../ClientQueryBoundary';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

function Recipe({ queryFn }: { readonly queryFn: () => Promise<string> }): ReactNode {
    const { data } = useSuspenseQuery({ queryKey: ['recipe'], queryFn });

    return <p>{data}</p>;
}

function tree(client: QueryClient, queryFn: () => Promise<string>, prefetchedKeys?: readonly QueryKey[]): ReactNode {
    return (
        <QueryClientProvider client={client}>
            <ClientQueryBoundary
                {...(prefetchedKeys === undefined ? {} : { prefetchedKeys })}
                loading={<p role="status">Loading recipe</p>}
                renderError={({ resetErrorBoundary }) => (
                    <div role="alert">
                        <button type="button" onClick={resetErrorBoundary}>
                            Try again
                        </button>
                    </div>
                )}
            >
                <Recipe queryFn={queryFn} />
            </ClientQueryBoundary>
        </QueryClientProvider>
    );
}

function testClient(): QueryClient {
    return new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
}

/** A client holding what a successful server prefetch dehydrates into the request's cache. */
function prefetchedClient(): QueryClient {
    const client = testClient();

    client.setQueryData(['recipe'], 'Weeknight pasta');

    return client;
}

describe('ClientQueryBoundary', () => {
    it('⛔ renders the loading fallback on the server and issues NO read there', () => {
        const queryFn = vi.fn(() => Promise.resolve('Weeknight pasta'));

        const html = renderToString(tree(testClient(), queryFn));

        // EQUAL to the fallback alone, not merely containing it: server HTML carrying anything more (a Suspense
        // marker, a second subtree) is markup the client then swaps out, which is the layout shift this avoids.
        expect(html).toBe(renderToString(<p role="status">Loading recipe</p>));
        expect(queryFn).not.toHaveBeenCalled();
    });

    it('hydrates onto the same loading markup, then reads once and shows the data', async () => {
        const queryFn = vi.fn(() => Promise.resolve('Weeknight pasta'));
        const container = document.createElement('div');
        container.innerHTML = renderToString(tree(testClient(), vi.fn()));
        document.body.append(container);
        const consoleError = vi.spyOn(console, 'error');

        await act(async () => {
            hydrateRoot(container, tree(testClient(), queryFn));
        });

        await vi.waitFor(() => expect(container.textContent).toContain('Weeknight pasta'));
        expect(queryFn).toHaveBeenCalledTimes(1);
        // A mismatch would mean the gate's hydration pass rendered something other than the server's markup.
        expect(consoleError.mock.calls.flat().join(' ')).not.toMatch(/hydrat/i);
        container.remove();
    });

    it('⛔ opens on the server when every prefetched key is ALREADY in the cache, rendering the data with no read', () => {
        const queryFn = vi.fn(() => Promise.resolve('never fetched'));

        const html = renderToString(tree(prefetchedClient(), queryFn, [['recipe']]));

        // A prefetched route ships its rows in the HTML; gating it would discard exactly what the prefetch paid for.
        expect(html).toContain('Weeknight pasta');
        expect(html).not.toContain('Loading recipe');
        expect(queryFn).not.toHaveBeenCalled();
    });

    it('stays closed on the server when ANY prefetched key missed, so a failed prefetch never reads there', () => {
        const queryFn = vi.fn(() => Promise.resolve('Weeknight pasta'));

        const html = renderToString(tree(prefetchedClient(), queryFn, [['recipe'], ['rails']]));

        expect(html).toBe(renderToString(<p role="status">Loading recipe</p>));
        expect(queryFn).not.toHaveBeenCalled();
    });

    it('hydrates the prefetched HTML with no recoverable error and no refetch', async () => {
        const queryFn = vi.fn(() => Promise.resolve('refetched'));
        const container = document.createElement('div');
        container.innerHTML = renderToString(tree(prefetchedClient(), vi.fn(), [['recipe']]));
        document.body.append(container);
        const onRecoverableError = vi.fn();

        // The HTML being hydrated is the DATA, not the skeleton — otherwise this would only re-prove the gated path.
        expect(container.textContent).toBe('Weeknight pasta');

        await act(async () => {
            hydrateRoot(container, tree(prefetchedClient(), queryFn, [['recipe']]), { onRecoverableError });
        });

        expect(container.textContent).toContain('Weeknight pasta');
        // Next reports every recoverable error; a designed degradation must never be carried by one.
        expect(onRecoverableError).not.toHaveBeenCalled();
        expect(queryFn).not.toHaveBeenCalled();
        container.remove();
    });

    it('on a client-side navigation reads straight away, and its failure retries through the boundary', async () => {
        const user = userEvent.setup();
        const queryFn = vi
            .fn<() => Promise<string>>()
            .mockRejectedValueOnce(new Error('recipe service unavailable'))
            .mockResolvedValueOnce('Weeknight pasta');
        vi.spyOn(console, 'error').mockImplementation(() => undefined);

        render(tree(testClient(), queryFn));

        await user.click(await screen.findByRole('button', { name: 'Try again' }));

        expect(await screen.findByText('Weeknight pasta')).toBeTruthy();
        expect(queryFn).toHaveBeenCalledTimes(2);
    });
});
