// @vitest-environment jsdom
/**
 * Tests for the web `useUserProfile` client hook — the profile/tier read that gates premium-only
 * capabilities (e.g. making a recipe private, C-004) on the client, mirroring the mobile hook so the two
 * platforms gate identically. `@clerk/nextjs` is mocked (no real Clerk session needed). Assertions observe
 * the ACTUAL outgoing `fetch` call (mirroring `AccountEditForm.test.tsx`/`AccountDeleteForm.test.tsx`,
 * both already asserting at this boundary) rather than an internal collaborator — the hook now goes through
 * `ProfileServiceClient` (DA10-c), and asserting on the real network call keeps this test correct across a
 * future internal refactor of that client, not coupled to which typed client happens to sit underneath.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createElement } from 'react';

const { useAuthMock, redirectToSignInOnceMock } = vi.hoisted(() => ({
    useAuthMock: vi.fn(),
    redirectToSignInOnceMock: vi.fn(),
}));

vi.mock('@clerk/nextjs', () => ({ useAuth: useAuthMock }));
vi.mock('@/lib/unauthorizedRedirect', () => ({ redirectToSignInOnce: redirectToSignInOnceMock }));

import { makeUserProfile, makeUserProfileAccount, makeUserProfileUser } from '@commise/features-account/testing';

import { useUserProfile } from '@/hooks/useUserProfile';

/**
 * A COMPLETE `UserProfile`, because `ProfileServiceClient` now PARSES its response against
 * `@kitchensink/schema-identity`'s `userProfileSchema` instead of casting it.
 *
 * It used to be `{ user: { id, displayName, email, status }, account: { subscriptionTier } }` — four of seven
 * `user` fields and one of five `account` fields — and it passed only because the client ended in
 * `JSON.parse(text) as T`. So this suite asserted the outgoing `fetch` against a body the identity service
 * cannot send, and would have gone on passing had the response shape changed. Built from
 * `@commise/features-account`'s `makeUserProfile` factory, so there is one representation of a valid profile
 * rather than a literal per test file; `paidFeatures` is the one field these cases actually care about.
 */
const premiumProfile = makeUserProfile({
    user: makeUserProfileUser({ id: 'usr_1', displayName: 'Ada', email: 'ada@example.com' }),
    account: makeUserProfileAccount({ paidFeatures: 'granted' }),
});

function wrapper({ children }: { children: ReactNode }) {
    // A fresh, retry-free client per render so an errored/absent query resolves fast and deterministically.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    return createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(premiumProfile),
        text: () => Promise.resolve(JSON.stringify(premiumProfile)),
    } as Response);
    useAuthMock.mockReturnValue({ isSignedIn: true, getToken: vi.fn().mockResolvedValue('tok_abc') });
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('useUserProfile (web)', () => {
    it('fetches the signed-in user profile from /api/v1/users/me and returns it', async () => {
        const { result } = renderHook(() => useUserProfile(), { wrapper });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(result.current.data?.account.paidFeatures).toBe('granted');
        const [url, init] = vi.mocked(global.fetch).mock.calls[0] as [string, RequestInit];
        expect(url).toContain('/api/v1/users/me');
        expect(init.method).toBe('GET');
    });

    it('mints a bearer token from the Clerk session and sends it as the Authorization header', async () => {
        const { result } = renderHook(() => useUserProfile(), { wrapper });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        const [, init] = vi.mocked(global.fetch).mock.calls[0] as [
            string,
            RequestInit & { headers: Record<string, string> },
        ];
        expect(init.headers['authorization']).toBe('Bearer tok_abc');
    });

    it('does not fetch when the viewer is signed out (query disabled)', () => {
        useAuthMock.mockReturnValue({ isSignedIn: false, getToken: vi.fn() });

        const { result } = renderHook(() => useUserProfile(), { wrapper });

        expect(result.current.fetchStatus).toBe('idle');
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('fails closed when the session yields no token: no request is sent, never an empty bearer', async () => {
        useAuthMock.mockReturnValue({ isSignedIn: true, getToken: vi.fn().mockResolvedValue(null) });

        const { result } = renderHook(() => useUserProfile(), { wrapper });

        await waitFor(() => expect(result.current.isError).toBe(true));

        expect(result.current.error).toMatchObject({ name: 'UnauthorizedError' });
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('does not bounce to sign-in when the token source fails for a non-auth reason (network down)', async () => {
        useAuthMock.mockReturnValue({
            isSignedIn: true,
            getToken: vi.fn().mockRejectedValue(new Error('network down')),
        });

        const { result } = renderHook(() => useUserProfile(), { wrapper });

        await waitFor(() => expect(result.current.isError).toBe(true));

        // A transient failure is not a lost session: bouncing would sign out a viewer who is merely offline.
        expect(global.fetch).not.toHaveBeenCalled();
        expect(redirectToSignInOnceMock).not.toHaveBeenCalled();
    });

    it('bounces to sign-in exactly once when the session yields no token (the pre-request 401 path)', async () => {
        useAuthMock.mockReturnValue({ isSignedIn: true, getToken: vi.fn().mockResolvedValue(null) });

        const { result } = renderHook(() => useUserProfile(), { wrapper });

        await waitFor(() => expect(result.current.isError).toBe(true));

        // The token refusal happens before any request, so the client's own `onUnauthorized` never runs;
        // web's recovery policy must still fire, once.
        expect(global.fetch).not.toHaveBeenCalled();
        expect(redirectToSignInOnceMock).toHaveBeenCalledTimes(1);
    });

    it('recovers from a refused first bearer by replaying once with a freshly minted token', async () => {
        const getToken = vi.fn(async (options?: { skipCache?: boolean }) =>
            options?.skipCache === true ? 'tok_fresh' : 'tok_stale',
        );
        useAuthMock.mockReturnValue({ isSignedIn: true, getToken });
        vi.mocked(global.fetch)
            .mockResolvedValueOnce({
                ok: false,
                status: 401,
                json: () => Promise.resolve({ code: 'IDENTITY_SYNC_PENDING' }),
                text: () => Promise.resolve(JSON.stringify({ code: 'IDENTITY_SYNC_PENDING' })),
            } as Response)
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: () => Promise.resolve(premiumProfile),
                text: () => Promise.resolve(JSON.stringify(premiumProfile)),
            } as Response);

        const { result } = renderHook(() => useUserProfile(), { wrapper });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        const bearers = vi
            .mocked(global.fetch)
            .mock.calls.map(([, init]) => (init as { headers: Record<string, string> }).headers['authorization']);
        expect(bearers).toEqual(['Bearer tok_stale', 'Bearer tok_fresh']);
    });
});
