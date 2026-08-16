// @vitest-environment jsdom
/**
 * Behaviour tests for the ACCOUNT-level erasure command (web; plan U2).
 *
 * ⛔ Why this suite exists. `useEraseAccount` is the call that makes an erasure reach anything beyond the
 * recipe service, and it shipped with **no test on either platform** — every suite that exercises the erase
 * flow doubles this hook at its own seam, so nothing observed what it actually sends. The two properties
 * below are the ones that cannot be observed from a doubled seam:
 *
 * 1. **It is a genuinely different request from the CLOSURE.** `POST /api/v1/users/me/erasure`, never
 *    `DELETE /api/v1/users/me`. If it ever collapsed onto the closure endpoint the app's irreversible control
 *    would silently perform the RECOVERABLE action — a user told their data was destroyed would still have an
 *    account — and every doubled test in `AccountEraseForm.test.tsx` would go on passing.
 * 2. **A session that yields no token must not send the STRING `null` as a credential.** Clerk's `getToken`
 *    resolves `null`, `TokenSource` promises a string, and the hook bridges the two with `?? ''`. Dropping
 *    that coalesce produces `Authorization: Bearer null` — a credential-shaped value that is not a
 *    credential, on the one request in the app that cannot be undone.
 *
 * Assertions observe the ACTUAL outgoing `fetch` (URL, method, header), matching `tests/hooks/
 * useUserProfile.test.tsx` and `AccountEditForm.test.tsx`, rather than an internal collaborator — so they
 * stay correct across a refactor of whichever typed client sits underneath.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createElement } from 'react';

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));

vi.mock('@clerk/nextjs', () => ({ useAuth: useAuthMock }));

import { useEraseAccount } from '@/components/auth/useEraseAccount';

/**
 * The real `202 Accepted` body of `POST /api/v1/users/me/erasure`. `202` and not `204` because the erasure is
 * ASYNCHRONOUS — identity scrubs its own row synchronously and hands the Clerk delete + the cross-service
 * fan-out to the deletion worker — so the response acknowledges the request, which is why it HAS a body.
 * The client PARSES it against `eraseUserMeResponseSchema`, so an incomplete literal here would not survive.
 */
const accepted = {
    sub: '01JQZX0000000000000000USER',
    erasedAt: '2026-08-16T00:00:00.000Z',
    message: 'Account erasure initiated.',
};

function wrapper({ children }: { children: ReactNode }) {
    // Retry-free, so a rejected mutation settles once and deterministically.
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });

    return createElement(QueryClientProvider, { client }, children);
}

/** The outgoing request the hook actually made. */
function sentRequest(): { readonly url: string; readonly init: RequestInit & { headers: Record<string, string> } } {
    const [url, init] = vi.mocked(global.fetch).mock.calls[0] as [
        string,
        RequestInit & { headers: Record<string, string> },
    ];

    return { url: String(url), init };
}

beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 202,
        json: () => Promise.resolve(accepted),
        text: () => Promise.resolve(JSON.stringify(accepted)),
    } as Response);
    useAuthMock.mockReturnValue({ getToken: vi.fn().mockResolvedValue('tok_abc') });
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('useEraseAccount (web)', () => {
    it('POSTs the ERASURE endpoint — not the recoverable closure — and returns the accepted body', async () => {
        const { result } = renderHook(() => useEraseAccount(), { wrapper });
        result.current.mutate();

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        const { url, init } = sentRequest();
        expect(url).toContain('/api/v1/users/me/erasure');
        expect(init.method).toBe('POST');
        // The closure is `DELETE /api/v1/users/me`. Collapsing onto it would leave the account alive.
        expect(init.method).not.toBe('DELETE');
        expect(result.current.data).toEqual(accepted);
    });

    it('sends the Clerk session token as the bearer credential', async () => {
        const { result } = renderHook(() => useEraseAccount(), { wrapper });
        result.current.mutate();

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(sentRequest().init.headers['authorization']).toBe('Bearer tok_abc');
    });

    it('never sends the string "null" as a credential when the session yields no token', async () => {
        useAuthMock.mockReturnValue({ getToken: vi.fn().mockResolvedValue(null) });

        const { result } = renderHook(() => useEraseAccount(), { wrapper });
        result.current.mutate();

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        const authorization = sentRequest().init.headers['authorization'];
        expect(authorization).toBe('Bearer ');
        expect(authorization).not.toContain('null');
        expect(authorization).not.toContain('undefined');
    });

    it('reports a REJECTED erasure as an error rather than resolving — the flow must not sign the viewer out', async () => {
        // 503, not 401: a 401 additionally fires the web client's redirect-to-sign-in policy, which is
        // `unauthorizedRedirect`'s behaviour to assert, not this hook's. Identity being unable to accept the
        // erasure is the case that matters here.
        const failure = { code: 'SERVICE_UNAVAILABLE', message: 'Erasure could not be accepted.' };
        global.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 503,
            json: () => Promise.resolve(failure),
            text: () => Promise.resolve(JSON.stringify(failure)),
        } as Response);

        const { result } = renderHook(() => useEraseAccount(), { wrapper });
        result.current.mutate();

        await waitFor(() => expect(result.current.isError).toBe(true));

        // A resolved-on-failure mutation is precisely what would let the caller's `onSuccess` end the session
        // for an account that still exists — the original U2 defect, one layer down.
        expect(result.current.isSuccess).toBe(false);
    });
});
