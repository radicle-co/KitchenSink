/**
 * Behaviour tests for the ACCOUNT-level erasure command, now shared by both apps (it was two identical
 * `useMutation({ mutationFn: () => client.eraseMe() })` files). Moved here from web's `useEraseAccount.test.tsx`;
 * what stayed behind there is nothing — the web adapter is `useProfileServiceClient`, covered with it.
 *
 * ⛔ Why a real `ProfileServiceClient` over a stub `fetch`, not a doubled `eraseMe`: the property that matters is
 * WHAT GOES ON THE WIRE. The erasure is a genuinely different request from the recoverable CLOSURE
 * (`POST …/users/me/erasure`, never `DELETE …/users/me`); a hook that collapsed onto the closure would perform the
 * wrong irreversible-looking action while every doubled-seam test in the apps went on passing.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProfileServiceClient } from '../../profileServiceClient.js';
import { useEraseAccount } from '../useEraseAccount.js';

/** The real `202 Accepted` body: the erasure is asynchronous, so the response acknowledges rather than completes. */
const accepted = {
    sub: '01JQZX0000000000000000USER',
    erasedAt: '2026-08-16T00:00:00.000Z',
    message: 'Account erasure initiated.',
};

function wrapper({ children }: { readonly children: ReactNode }) {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });

    return createElement(QueryClientProvider, { client }, children);
}

function clientAnswering(status: number, body: unknown) {
    const fetchStub = vi.fn().mockResolvedValue({
        ok: status >= 200 && status < 300,
        status,
        text: () => Promise.resolve(JSON.stringify(body)),
    } as Response);

    return {
        fetchStub,
        client: new ProfileServiceClient({
            baseUrl: 'https://identity.test',
            token: 'tok_abc',
            fetch: fetchStub as unknown as typeof fetch,
        }),
    };
}

afterEach(cleanup);

describe('useEraseAccount', () => {
    it('POSTs the ERASURE endpoint with the bearer — not the recoverable closure — and returns the accepted body', async () => {
        const { client, fetchStub } = clientAnswering(202, accepted);
        const { result } = renderHook(() => useEraseAccount(client), { wrapper });

        result.current.mutate();
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        const [url, init] = fetchStub.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
        expect(String(url)).toBe('https://identity.test/api/v1/users/me/erasure');
        expect(init.method).toBe('POST');
        expect(init.headers['authorization']).toBe('Bearer tok_abc');
        expect(result.current.data).toEqual(accepted);
    });

    it('reports a REJECTED erasure as an error instead of resolving, so the flow cannot sign the viewer out', async () => {
        const { client } = clientAnswering(503, {
            code: 'SERVICE_UNAVAILABLE',
            message: 'Erasure could not be accepted.',
        });
        const { result } = renderHook(() => useEraseAccount(client), { wrapper });

        result.current.mutate();
        await waitFor(() => expect(result.current.isError).toBe(true));

        expect(result.current.isSuccess).toBe(false);
    });
});
