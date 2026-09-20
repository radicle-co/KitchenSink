// @vitest-environment node
/**
 * `createAppQueryClient` during the Next SERVER render pass — no `window`, exactly as a `'use client'` component
 * renders on the server.
 *
 * ⛔ WHY THIS FILE RUNS IN `node`, against the package's jsdom default. The environment IS the subject: the
 * factory must decide "server" from the absence of `window`, and the retry it withholds there is the one that
 * waits for a Clerk session only a browser can hydrate. Under jsdom there is always a `window`, so the default
 * branch this asserts could never be reached.
 *
 * The render test drives the REAL React server renderer over a real suspense read, because the stall it guards
 * is measured in query-function calls made while the HTML stream is held open: a read that retries three times
 * with 1 s/2 s/4 s backoff inside a server render holds the response for ~7 s, and a retry-count option read
 * back from the client object would not prove the renderer honoured it.
 */
import { QueryClientProvider, QueryObserver, useSuspenseQuery } from '@tanstack/react-query';
import { UnexpectedResponseError } from '@kitchensink/recipe-service-client';
import { Suspense } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { createAppQueryClient } from '../queryClient.js';

describe('createAppQueryClient — the server render pass', () => {
    it('defaults to the SERVER policy when there is no window, and a failing read issues ONE attempt', async () => {
        const client = createAppQueryClient();
        const queryFn = vi.fn().mockRejectedValue(new UnexpectedResponseError(500));
        const observer = new QueryObserver(client, { queryKey: ['server-pass'], queryFn });

        await new Promise<void>((resolve) => {
            const unsubscribe = observer.subscribe((result) => {
                if (result.isError) {
                    unsubscribe();
                    resolve();
                }
            });
        });

        expect(queryFn).toHaveBeenCalledTimes(1);
    });

    it('a suspense read that fails during renderToString is attempted once, not retried behind the stream', async () => {
        const client = createAppQueryClient();
        const queryFn = vi.fn().mockRejectedValue(new UnexpectedResponseError(503));

        function Reader() {
            useSuspenseQuery({ queryKey: ['server-render'], queryFn });

            return <p>settled</p>;
        }

        renderToString(
            <QueryClientProvider client={client}>
                <Suspense fallback={<p role="status">Loading</p>}>
                    <Reader />
                </Suspense>
            </QueryClientProvider>,
        );

        await vi.waitFor(() => {
            expect(client.getQueryState(['server-render'])?.status).toBe('error');
        });
        expect(queryFn).toHaveBeenCalledTimes(1);
    });

    it('an explicit BROWSER client keeps the retry policy even where there is no window', async () => {
        const client = createAppQueryClient('browser');
        const queryFn = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
        const observer = new QueryObserver(client, { queryKey: ['explicit-browser'], queryFn, retryDelay: 0 });

        await new Promise<void>((resolve) => {
            const unsubscribe = observer.subscribe((result) => {
                if (result.isError) {
                    unsubscribe();
                    resolve();
                }
            });
        });

        expect(queryFn.mock.calls.length).toBeGreaterThan(1);
    });
});
