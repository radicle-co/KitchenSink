/**
 * The recipe library's grid/list choice as an ACCOUNT setting (ADR-0059, owner ruling 2026-10-17), read and written by
 * web and mobile through this one hook. Run over a real `QueryClient` and the real mutation, with only the client's
 * transport spied, so the states a screen draws — default, chosen, saving, failed — are the cache's own.
 */
import { SETTINGS_DEFAULTS, type UserSettings } from '@kitchensink/schema-identity';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook, waitFor, act } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProfileServiceClient } from '../profileServiceClient.js';
import { profileServiceKeys } from '../queries.js';
import { useRecipeViewSetting } from '../useRecipeViewSetting.js';

afterEach(cleanup);

function arrange(server: UserSettings = SETTINGS_DEFAULTS) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const client = new ProfileServiceClient({ baseUrl: 'https://identity.example.test', token: 'tok_123' });
    const getSettings = vi.spyOn(client, 'getSettings').mockResolvedValue(server);
    const patchSettings = vi.spyOn(client, 'patchSettings');
    const wrapper = ({ children }: { readonly children: ReactNode }) =>
        createElement(QueryClientProvider, { client: queryClient }, children);

    return { client, queryClient, getSettings, patchSettings, wrapper };
}

describe('useRecipeViewSetting', () => {
    it('DEFAULT: a cook who never chose has no choice, so the width picks', async () => {
        const { client, getSettings, wrapper } = arrange({ ...SETTINGS_DEFAULTS, recipeViewMode: 'auto' });
        const { result } = renderHook(() => useRecipeViewSetting(client, true), { wrapper });

        await waitFor(() => expect(getSettings).toHaveBeenCalledTimes(1));
        expect(result.current.viewChoice).toBeUndefined();
        expect(result.current.saveFailed).toBe(false);
    });

    it.each(['grid', 'list'] as const)('CHOSEN: reads the stored %s from the server', async (recipeViewMode) => {
        const { client, wrapper } = arrange({ ...SETTINGS_DEFAULTS, recipeViewMode });
        const { result } = renderHook(() => useRecipeViewSetting(client, true), { wrapper });

        await waitFor(() => expect(result.current.viewChoice).toBe(recipeViewMode));
    });

    it('reads a choice a server render already put in the cache, with NO request', () => {
        const { client, queryClient, getSettings, wrapper } = arrange();
        queryClient.setQueryData(profileServiceKeys.settings, { ...SETTINGS_DEFAULTS, recipeViewMode: 'list' });

        const { result } = renderHook(() => useRecipeViewSetting(client, true), { wrapper });

        expect(result.current.viewChoice).toBe('list');
        expect(getSettings).not.toHaveBeenCalled();
    });

    it('SIGNED OUT: reads nothing and offers no choice', () => {
        const { client, getSettings, wrapper } = arrange({ ...SETTINGS_DEFAULTS, recipeViewMode: 'list' });
        const { result } = renderHook(() => useRecipeViewSetting(client, false), { wrapper });

        expect(getSettings).not.toHaveBeenCalled();
        expect(result.current.viewChoice).toBeUndefined();
    });

    it('SAVING: the choice shows at once, before the server answers, and sends only the view', async () => {
        const { client, patchSettings, wrapper } = arrange({ ...SETTINGS_DEFAULTS, recipeViewMode: 'grid' });
        let release: (value: UserSettings) => void = () => undefined;
        patchSettings.mockReturnValue(new Promise<UserSettings>((resolve) => (release = resolve)));
        const { result } = renderHook(() => useRecipeViewSetting(client, true), { wrapper });
        await waitFor(() => expect(result.current.viewChoice).toBe('grid'));

        act(() => result.current.chooseView('list'));

        await waitFor(() => expect(result.current.viewChoice).toBe('list'));
        expect(patchSettings).toHaveBeenCalledWith({ recipeViewMode: 'list' });
        expect(result.current.saveFailed).toBe(false);

        release({ ...SETTINGS_DEFAULTS, recipeViewMode: 'list' });
    });

    it('FAILED: the view goes back to what it was and the failure is reported', async () => {
        const { client, patchSettings, wrapper } = arrange({ ...SETTINGS_DEFAULTS, recipeViewMode: 'grid' });
        patchSettings.mockRejectedValue(new Error('503'));
        const { result } = renderHook(() => useRecipeViewSetting(client, true), { wrapper });
        await waitFor(() => expect(result.current.viewChoice).toBe('grid'));

        act(() => result.current.chooseView('list'));

        await waitFor(() => expect(result.current.saveFailed).toBe(true));
        expect(result.current.viewChoice).toBe('grid');
    });

    it('the failure clears when the cook chooses again', async () => {
        const { client, patchSettings, wrapper } = arrange({ ...SETTINGS_DEFAULTS, recipeViewMode: 'grid' });
        patchSettings.mockRejectedValueOnce(new Error('503'));
        patchSettings.mockResolvedValueOnce({ ...SETTINGS_DEFAULTS, recipeViewMode: 'list' });
        const { result } = renderHook(() => useRecipeViewSetting(client, true), { wrapper });
        await waitFor(() => expect(result.current.viewChoice).toBe('grid'));

        act(() => result.current.chooseView('list'));
        await waitFor(() => expect(result.current.saveFailed).toBe(true));
        act(() => result.current.chooseView('list'));

        await waitFor(() => expect(result.current.saveFailed).toBe(false));
    });
});
