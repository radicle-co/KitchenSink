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

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));

vi.mock('@clerk/nextjs', () => ({ useAuth: useAuthMock }));

import { useUserProfile } from '@/hooks/useUserProfile';

const premiumProfile = {
    user: { id: 'usr_1', displayName: 'Ada', email: 'ada@example.com', status: 'active' },
    account: { subscriptionTier: 'premium' },
};

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

        expect(result.current.data?.account.subscriptionTier).toBe('premium');
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

    it('sends an empty bearer when the session yields no token, without throwing', async () => {
        useAuthMock.mockReturnValue({ isSignedIn: true, getToken: vi.fn().mockResolvedValue(null) });

        const { result } = renderHook(() => useUserProfile(), { wrapper });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        const [, init] = vi.mocked(global.fetch).mock.calls[0] as [
            string,
            RequestInit & { headers: Record<string, string> },
        ];
        expect(init.headers['authorization']).toBe('Bearer ');
    });
});
