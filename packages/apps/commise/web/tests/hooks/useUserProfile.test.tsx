// @vitest-environment jsdom
/**
 * Tests for the web `useUserProfile` client hook — the profile/tier read that gates premium-only
 * capabilities (e.g. making a recipe private, C-004) on the client, mirroring the mobile hook so the two
 * platforms gate identically. `@clerk/nextjs` and the shared `apiClient` are mocked so no real network or
 * Clerk session is needed; assertions are on the query result and on the exact endpoint + bearer token the
 * hook sends.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createElement } from 'react';

const { useAuthMock, getMock, buildApiClientMock } = vi.hoisted(() => ({
    useAuthMock: vi.fn(),
    getMock: vi.fn(),
    buildApiClientMock: vi.fn(),
}));

vi.mock('@clerk/nextjs', () => ({ useAuth: useAuthMock }));
vi.mock('@/lib/apiClient', () => ({ buildApiClient: buildApiClientMock }));

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
    getMock.mockResolvedValue(premiumProfile);
    buildApiClientMock.mockReturnValue({ get: getMock });
    useAuthMock.mockReturnValue({ isSignedIn: true, getToken: vi.fn().mockResolvedValue('tok_abc') });
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('useUserProfile (web)', () => {
    it('fetches the signed-in user profile from /v1/users/me and returns it', async () => {
        const { result } = renderHook(() => useUserProfile(), { wrapper });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(result.current.data?.account.subscriptionTier).toBe('premium');
        expect(getMock).toHaveBeenCalledWith('/v1/users/me');
    });

    it('mints a bearer token from the Clerk session and builds the client with it', async () => {
        const { result } = renderHook(() => useUserProfile(), { wrapper });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(buildApiClientMock).toHaveBeenCalledWith('tok_abc');
    });

    it('does not fetch when the viewer is signed out (query disabled)', () => {
        useAuthMock.mockReturnValue({ isSignedIn: false, getToken: vi.fn() });

        const { result } = renderHook(() => useUserProfile(), { wrapper });

        expect(result.current.fetchStatus).toBe('idle');
        expect(getMock).not.toHaveBeenCalled();
    });

    it('sends an empty bearer when the session yields no token, without throwing', async () => {
        useAuthMock.mockReturnValue({ isSignedIn: true, getToken: vi.fn().mockResolvedValue(null) });

        const { result } = renderHook(() => useUserProfile(), { wrapper });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(buildApiClientMock).toHaveBeenCalledWith('');
    });
});
