import { QueryClient, QueryClientProvider, useSuspenseQuery } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { FallbackProps } from 'react-error-boundary';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { QueryBoundary } from '../QueryBoundary.js';

afterEach(cleanup);

function Recipe({ queryFn }: { readonly queryFn: () => Promise<string> }): ReactNode {
    const { data } = useSuspenseQuery({ queryKey: ['recipe'], queryFn });

    return <p>{data}</p>;
}

function Failed({ error, resetErrorBoundary, escape }: FallbackProps & { readonly escape?: string }): ReactNode {
    return (
        <div role="alert">
            <p>{error instanceof Error ? error.message : 'failed'}</p>
            {escape === undefined ? null : <a href="/recipes">{escape}</a>}
            <button type="button" onClick={resetErrorBoundary}>
                Try again
            </button>
        </div>
    );
}

function renderBoundary(
    queryFn: () => Promise<string>,
    { onError, escape }: { readonly onError?: (error: unknown) => void; readonly escape?: string } = {},
) {
    // `retry: false` so a failure reaches the boundary on the first attempt; the retry under test is the cook's.
    // `staleTime: Infinity` so a read that resolves is not refetched again on mount — the fetch count then measures
    // the retry alone, however long the resolved read took to commit.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });

    render(
        <QueryClientProvider client={client}>
            <QueryBoundary
                loading={<p>Loading recipe</p>}
                renderError={(fallback) => <Failed {...fallback} escape={escape} />}
                onError={onError}
            >
                <Recipe queryFn={queryFn} />
            </QueryBoundary>
        </QueryClientProvider>,
    );
}

describe('QueryBoundary', () => {
    it('shows the loading fallback while the read is pending, then the data', async () => {
        let resolve: (value: string) => void = () => undefined;
        renderBoundary(() => new Promise<string>((settle) => (resolve = settle)));

        expect(screen.getByText('Loading recipe')).toBeTruthy();

        resolve('Weeknight pasta');
        expect(await screen.findByText('Weeknight pasta')).toBeTruthy();
    });

    it('shows the error fallback when the read fails, and reports it', async () => {
        const onError = vi.fn();
        renderBoundary(() => Promise.reject(new Error('recipe service unavailable')), { onError });

        expect(await screen.findByRole('alert')).toBeTruthy();
        expect(screen.getByText('recipe service unavailable')).toBeTruthy();
        expect(onError).toHaveBeenCalledWith(
            expect.objectContaining({ message: 'recipe service unavailable' }),
            expect.anything(),
        );
    });

    it("renders the caller's own way out inside the error fallback", async () => {
        // The fallback is a render function, so a surface's failure body can close over the surface's props (a
        // Back control bound to the screen's navigator) without a component type created per render.
        renderBoundary(() => Promise.reject(new Error('recipe service unavailable')), { escape: 'Back to recipes' });

        expect(await screen.findByRole('link', { name: 'Back to recipes' })).toBeTruthy();
    });

    /**
     * ⛔ THE PROPERTY THIS PRIMITIVE EXISTS FOR. A query that threw into a boundary keeps `retryOnMount` off until
     * TanStack's query-error reset boundary is reset, so an `ErrorBoundary` alone re-renders straight back into the
     * same cached failure. Try again must REFETCH: two calls, and the data on screen.
     */
    it('⛔ Try again refetches rather than re-rendering the cached failure', async () => {
        const queryFn = vi
            .fn<() => Promise<string>>()
            .mockRejectedValueOnce(new Error('recipe service unavailable'))
            .mockResolvedValueOnce('Weeknight pasta');
        renderBoundary(queryFn);

        (await screen.findByRole('button', { name: 'Try again' })).click();

        expect(await screen.findByText('Weeknight pasta')).toBeTruthy();
        await waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2));
    });
});
