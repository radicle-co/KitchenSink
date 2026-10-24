// @vitest-environment jsdom
/**
 * The web settings read goes through the SAME identity-client token policy as the profile read: a missing token
 * sends no request (never an empty bearer), and a refused bearer is replayed once with a freshly minted token.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createElement } from 'react';
import { SETTINGS_DEFAULTS } from '@kitchensink/schema-identity';

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));

vi.mock('@clerk/nextjs', () => ({ useAuth: useAuthMock }));

import { useUserSettings } from '@/hooks/useUserSettings';

const reply = (status: number, body: unknown): Response =>
    ({
        ok: status < 400,
        status,
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(JSON.stringify(body)),
    }) as Response;

function wrapper({ children }: { children: ReactNode }) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    return createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue(reply(200, SETTINGS_DEFAULTS));
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('useUserSettings (web)', () => {
    it('sends no request when the session yields no token', async () => {
        useAuthMock.mockReturnValue({ isSignedIn: true, getToken: vi.fn().mockResolvedValue(null) });

        const { result } = renderHook(() => useUserSettings(), { wrapper });

        await waitFor(() => expect(result.current.isError).toBe(true));

        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('replays a refused first bearer once, with a freshly minted token', async () => {
        const getToken = vi.fn(async (options?: { skipCache?: boolean }) =>
            options?.skipCache === true ? 'tok_fresh' : 'tok_stale',
        );
        useAuthMock.mockReturnValue({ isSignedIn: true, getToken });
        vi.mocked(global.fetch)
            .mockResolvedValueOnce(reply(401, { code: 'IDENTITY_SYNC_PENDING' }))
            .mockResolvedValueOnce(reply(200, SETTINGS_DEFAULTS));

        const { result } = renderHook(() => useUserSettings(), { wrapper });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        // The contract-skew probe is a separate, header-less request; only the identity calls carry a bearer.
        const bearers = vi
            .mocked(global.fetch)
            .mock.calls.map(
                ([, init]) => (init as { headers?: Record<string, string> } | undefined)?.headers?.['authorization'],
            )
            .filter((bearer) => bearer !== undefined);
        expect(bearers).toEqual(['Bearer tok_stale', 'Bearer tok_fresh']);
    });
});
