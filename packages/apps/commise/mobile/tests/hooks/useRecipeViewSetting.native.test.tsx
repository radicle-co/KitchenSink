/**
 * The mobile read and write of the recipe library's grid/list choice, an ACCOUNT setting (ADR-0059, owner ruling
 * 2026-10-17). It replaces `useStoredViewMode`, which kept the choice per device in `AsyncStorage` under
 * `recipes.viewMode`; that hook and its test are deleted, and what its test pinned moves here: a stored choice is read, a
 * new one shows at once and is stored, and a value that is not a view is ignored (now by the wire schema's parse, which
 * REJECTS the response instead of guessing).
 *
 * `@clerk/expo` is mocked; assertions observe the ACTUAL outgoing `fetch` (URL, method, body, bearer, token template), as
 * `useUserProfile.native.test.tsx` does, so the adapter's wiring to the identity transport is what is under test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuth } from '@clerk/expo';
import { SETTINGS_DEFAULTS, type UserSettings } from '@kitchensink/schema-identity';
import type { ReactNode } from 'react';
import { createElement } from 'react';

vi.mock('@clerk/expo', () => ({ useAuth: vi.fn() }));

import { useRecipeViewSetting } from '../../src/hooks/useRecipeViewSetting.js';

const useAuthMock = vi.mocked(useAuth);

function wrapper({ children }: { children: ReactNode }) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

    return createElement(QueryClientProvider, { client }, children);
}

/** The request body as the transport sends it: a JSON string. */
const bodyOf = (init: RequestInit | undefined): string => (typeof init?.body === 'string' ? init.body : '');

/** The request URL as the transport sends it: a string. */
const urlOf = (input: unknown): string => (typeof input === 'string' ? input : '');

const reply = (status: number, body: unknown): Response =>
    ({
        ok: status < 400,
        status,
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(JSON.stringify(body)),
    }) as Response;

/** A fake identity service: GET answers what it holds, PATCH merges the body in. */
function serveSettings(held: UserSettings, patchStatus = 200) {
    let current = held;

    global.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
        if (init?.method === 'PATCH') {
            if (patchStatus >= 400) {
                return reply(patchStatus, { code: 'FORBIDDEN', message: 'Account is closed' });
            }

            current = { ...current, ...(JSON.parse(bodyOf(init)) as Partial<UserSettings>) };
        }

        return reply(200, current);
    }) as typeof fetch;
}

const getToken = vi.fn();

/** The calls the hook made to the settings endpoint (the transport may also probe the contract fingerprint). */
const settingsCalls = (method: string) =>
    vi
        .mocked(global.fetch)
        .mock.calls.filter(([url, init]) => urlOf(url).includes('/users/me/settings') && init?.method === method);

beforeEach(() => {
    getToken.mockReset().mockResolvedValue('tok_native');
    useAuthMock.mockReturnValue({ getToken, isSignedIn: true } as unknown as ReturnType<typeof useAuth>);
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('useRecipeViewSetting (mobile)', () => {
    it('DEFAULT: nothing chosen is no choice, so the width picks, and nothing is written', async () => {
        serveSettings(SETTINGS_DEFAULTS);
        const { result } = renderHook(() => useRecipeViewSetting(), { wrapper });

        await waitFor(() => expect(settingsCalls('GET')).toHaveLength(1));

        expect(result.current.viewChoice).toBeUndefined();
        expect(result.current.saveFailed).toBe(false);
        expect(settingsCalls('PATCH')).toHaveLength(0);
    });

    it('CHOSEN: reads GET /api/v1/users/me/settings with the native token template and takes the stored choice', async () => {
        serveSettings({ ...SETTINGS_DEFAULTS, recipeViewMode: 'grid' });
        const { result } = renderHook(() => useRecipeViewSetting(), { wrapper });

        await waitFor(() => expect(result.current.viewChoice).toBe('grid'));

        const [[url, init]] = settingsCalls('GET') as [[string, RequestInit & { headers: Record<string, string> }]];
        expect(url).toContain('/api/v1/users/me/settings');
        expect(init.headers['authorization']).toBe('Bearer tok_native');
        expect(getToken).toHaveBeenCalledWith(expect.objectContaining({ template: 'commise-native' }));
    });

    it('SAVING: a new choice shows at once and is sent as the only key of a PATCH', async () => {
        serveSettings({ ...SETTINGS_DEFAULTS, recipeViewMode: 'grid' });
        const { result } = renderHook(() => useRecipeViewSetting(), { wrapper });
        await waitFor(() => expect(result.current.viewChoice).toBe('grid'));

        act(() => result.current.chooseView('list'));

        await waitFor(() => expect(result.current.viewChoice).toBe('list'));
        await waitFor(() => expect(settingsCalls('PATCH')).toHaveLength(1));
        expect(JSON.parse(bodyOf(settingsCalls('PATCH')[0]?.[1]))).toEqual({ recipeViewMode: 'list' });
    });

    it('FAILED: the view goes back and the failure is reported', async () => {
        serveSettings({ ...SETTINGS_DEFAULTS, recipeViewMode: 'grid' }, 403);
        const { result } = renderHook(() => useRecipeViewSetting(), { wrapper });
        await waitFor(() => expect(result.current.viewChoice).toBe('grid'));

        act(() => result.current.chooseView('list'));

        await waitFor(() => expect(result.current.saveFailed).toBe(true));
        expect(result.current.viewChoice).toBe('grid');
    });

    it('SIGNED OUT: reads nothing and offers no choice', () => {
        useAuthMock.mockReturnValue({ getToken, isSignedIn: false } as unknown as ReturnType<typeof useAuth>);
        serveSettings({ ...SETTINGS_DEFAULTS, recipeViewMode: 'list' });

        const { result } = renderHook(() => useRecipeViewSetting(), { wrapper });

        expect(settingsCalls('GET')).toHaveLength(0);
        expect(result.current.viewChoice).toBeUndefined();
    });

    it('a response that is not a view is REJECTED, so the stored value is never guessed at', async () => {
        serveSettings({ ...SETTINGS_DEFAULTS, recipeViewMode: 'tiles' as never });
        const { result } = renderHook(() => useRecipeViewSetting(), { wrapper });

        await waitFor(() => expect(settingsCalls('GET')).toHaveLength(1));
        await act(async () => undefined);

        expect(result.current.viewChoice).toBeUndefined();
    });
});
