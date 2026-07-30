/**
 * Tests for the mobile `useUserProfile`/`useUpdateProfile`/`useDeleteAccount` hooks (DA10-c) — now built on
 * the typed `ProfileServiceClient` instead of the retired `services/api.ts` `getUserMe`/`patchUserMe`/
 * `deleteUserMe`. `@clerk/expo` is mocked; assertions observe the ACTUAL outgoing `fetch` call (URL, method,
 * body, bearer token, `skipCache` policy) — the same coverage `tests/api.test.ts` used to pin at the
 * `services/api.ts` layer, relocated here now that the hooks own the request directly.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuth } from '@clerk/expo';
import type { ReactNode } from 'react';
import { createElement } from 'react';

vi.mock('@clerk/expo', () => ({ useAuth: vi.fn() }));

import { useDeleteAccount, useUpdateProfile, useUserProfile } from '../../src/hooks/useUserProfile.js';

const useAuthMock = vi.mocked(useAuth);

function wrapper({ children }: { children: ReactNode }) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

    return createElement(QueryClientProvider, { client }, children);
}

const profile = { user: { id: 'usr_1', displayName: 'Ada' }, account: {} };

beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(profile),
        text: () => Promise.resolve(JSON.stringify(profile)),
    } as Response);
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('useUserProfile (mobile)', () => {
    it('GETs /v1/users/me with a template + skipCache-true (always force-refreshed) token', async () => {
        const getToken = vi.fn().mockResolvedValue('tok_fresh');
        useAuthMock.mockReturnValue({ getToken, isSignedIn: true } as unknown as ReturnType<typeof useAuth>);

        const { result } = renderHook(() => useUserProfile(), { wrapper });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(getToken).toHaveBeenCalledWith({ template: 'commise-native', skipCache: true });
        const [url, init] = vi.mocked(global.fetch).mock.calls[0] as [
            string,
            RequestInit & { headers: Record<string, string> },
        ];
        expect(url).toContain('/v1/users/me');
        expect(init.method).toBe('GET');
        expect(init.headers['authorization']).toBe('Bearer tok_fresh');
        expect(result.current.data).toEqual(profile);
    });

    it('does not fetch when signed out (query disabled)', () => {
        useAuthMock.mockReturnValue({
            getToken: vi.fn(),
            isSignedIn: false,
        } as unknown as ReturnType<typeof useAuth>);

        const { result } = renderHook(() => useUserProfile(), { wrapper });

        expect(result.current.fetchStatus).toBe('idle');
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('surfaces a typed UnauthorizedError, without fetching, when no session token is available', async () => {
        useAuthMock.mockReturnValue({
            getToken: vi.fn().mockResolvedValue(null),
            isSignedIn: true,
        } as unknown as ReturnType<typeof useAuth>);

        const { result } = renderHook(() => useUserProfile(), { wrapper });

        await waitFor(() => expect(result.current.isError).toBe(true));

        expect(result.current.error).toMatchObject({ name: 'UnauthorizedError' });
        expect(global.fetch).not.toHaveBeenCalled();
    });
});

describe('useUpdateProfile (mobile)', () => {
    it('PATCHes /v1/users/me with a NON-forced (cache-allowed) token and the update body', async () => {
        const getToken = vi.fn().mockResolvedValue('tok_cached');
        useAuthMock.mockReturnValue({ getToken } as unknown as ReturnType<typeof useAuth>);

        const { result } = renderHook(() => useUpdateProfile(), { wrapper });
        result.current.mutate({ displayName: 'Ada Lovelace', avatarUrl: null });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(getToken).toHaveBeenCalledWith({ template: 'commise-native', skipCache: false });
        const [url, init] = vi.mocked(global.fetch).mock.calls[0] as [
            string,
            RequestInit & { headers: Record<string, string> },
        ];
        expect(url).toContain('/v1/users/me');
        expect(url).not.toContain('/v1/profiles/me');
        expect(init.method).toBe('PATCH');
        expect(init.body).toBe(JSON.stringify({ displayName: 'Ada Lovelace', avatarUrl: null }));
    });
});

describe('useDeleteAccount (mobile)', () => {
    it('DELETEs /v1/users/me then signs out', async () => {
        const getToken = vi.fn().mockResolvedValue('tok_cached');
        const signOut = vi.fn().mockResolvedValue(undefined);
        useAuthMock.mockReturnValue({ getToken, signOut } as unknown as ReturnType<typeof useAuth>);
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 202,
            json: () => Promise.resolve({}),
            text: () => Promise.resolve(''),
        } as Response);

        const { result } = renderHook(() => useDeleteAccount(), { wrapper });
        result.current.mutate();

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        const [url, init] = vi.mocked(global.fetch).mock.calls[0] as [string, RequestInit];
        expect(url).toContain('/v1/users/me');
        expect(init.method).toBe('DELETE');
        expect(signOut).toHaveBeenCalledTimes(1);
    });
});
