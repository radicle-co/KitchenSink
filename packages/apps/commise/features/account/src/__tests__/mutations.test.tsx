/**
 * The ONE profile write both apps make (`PATCH /api/v1/users/me`): web's display-name sheet and mobile's display name
 * and photo all run this mutation, so what it sends and what it refreshes cannot differ between them. Run through a
 * real `useMutation` over a real `QueryClient`, with only the client's transport spied.
 */
import { SETTINGS_DEFAULTS, type UserSettings } from '@kitchensink/schema-identity';
import { QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeUserProfile } from '../__fixtures__/index.js';
import { profileMutations } from '../mutations.js';
import { ProfileServiceClient } from '../profileServiceClient.js';
import { profileServiceKeys } from '../queries.js';

afterEach(cleanup);

function arrange() {
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const client = new ProfileServiceClient({ baseUrl: 'https://identity.example.test', token: 'tok_123' });
    const patchMe = vi.spyOn(client, 'patchMe').mockResolvedValue(makeUserProfile());
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const wrapper = ({ children }: { readonly children: ReactNode }) =>
        createElement(QueryClientProvider, { client: queryClient }, children);

    return { client, patchMe, invalidate, wrapper };
}

describe('profileMutations(client).update()', () => {
    it('PATCHes the body it is given and refreshes the shared profile read', async () => {
        const { client, patchMe, invalidate, wrapper } = arrange();
        const { result } = renderHook(() => useMutation(profileMutations(client).update()), { wrapper });

        result.current.mutate({ displayName: 'Eliza', avatarUrl: null });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(patchMe).toHaveBeenCalledWith({ displayName: 'Eliza', avatarUrl: null });
        expect(invalidate).toHaveBeenCalledWith({ queryKey: profileServiceKeys.me });
    });

    it('refreshes nothing when the PATCH fails', async () => {
        const { client, patchMe, invalidate, wrapper } = arrange();
        patchMe.mockRejectedValueOnce(new Error('503'));
        const { result } = renderHook(() => useMutation(profileMutations(client).update()), { wrapper });

        result.current.mutate({ displayName: 'Eliza' });

        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(invalidate).not.toHaveBeenCalled();
    });
});

describe('profileMutations(client).patchSettings()', () => {
    function arrangeSettings(options: { readonly cached?: UserSettings } = {}) {
        const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
        const client = new ProfileServiceClient({ baseUrl: 'https://identity.example.test', token: 'tok_123' });
        const patchSettings = vi.spyOn(client, 'patchSettings');
        const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
        const wrapper = ({ children }: { readonly children: ReactNode }) =>
            createElement(QueryClientProvider, { client: queryClient }, children);

        if (options.cached !== undefined) {
            queryClient.setQueryData(profileServiceKeys.settings, options.cached);
        }

        return { client, queryClient, patchSettings, invalidate, wrapper };
    }

    const cached = (queryClient: QueryClient) => queryClient.getQueryData<UserSettings>(profileServiceKeys.settings);

    it('updates the cache BEFORE the server answers (optimistic), and sends only what it was given', async () => {
        const { client, queryClient, patchSettings, wrapper } = arrangeSettings({ cached: { searchShortcut: true } });
        let release: (value: UserSettings) => void = () => undefined;
        patchSettings.mockReturnValue(new Promise<UserSettings>((resolve) => (release = resolve)));
        const { result } = renderHook(() => useMutation(profileMutations(client).patchSettings()), { wrapper });

        result.current.mutate({ searchShortcut: false });

        await waitFor(() => expect(cached(queryClient)).toEqual({ searchShortcut: false }));
        expect(result.current.isPending).toBe(true);
        expect(patchSettings).toHaveBeenCalledWith({ searchShortcut: false });

        release({ searchShortcut: false });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });

    it('rolls the cache BACK to the snapshot when the write fails', async () => {
        const { client, queryClient, patchSettings, wrapper } = arrangeSettings({ cached: { searchShortcut: true } });
        patchSettings.mockRejectedValue(new Error('503'));
        const { result } = renderHook(() => useMutation(profileMutations(client).patchSettings()), { wrapper });

        result.current.mutate({ searchShortcut: false });

        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(cached(queryClient)).toEqual({ searchShortcut: true });
    });

    it('rolls back to the DEFAULTS when nothing was cached before the write', async () => {
        const { client, queryClient, patchSettings, wrapper } = arrangeSettings();
        patchSettings.mockRejectedValue(new Error('503'));
        const { result } = renderHook(() => useMutation(profileMutations(client).patchSettings()), { wrapper });

        result.current.mutate({ searchShortcut: false });

        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(cached(queryClient)).toEqual(SETTINGS_DEFAULTS);
    });

    it('refetches settings when it settles, on success AND on failure', async () => {
        const { client, patchSettings, invalidate, wrapper } = arrangeSettings({ cached: { searchShortcut: true } });
        patchSettings.mockResolvedValueOnce({ searchShortcut: false }).mockRejectedValueOnce(new Error('503'));
        const { result } = renderHook(() => useMutation(profileMutations(client).patchSettings()), { wrapper });

        result.current.mutate({ searchShortcut: false });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(invalidate).toHaveBeenCalledWith({ queryKey: profileServiceKeys.settings });

        invalidate.mockClear();
        result.current.mutate({ searchShortcut: true });
        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(invalidate).toHaveBeenCalledWith({ queryKey: profileServiceKeys.settings });
    });

    it('does not refresh the profile read — a setting is not part of the profile', async () => {
        const { client, patchSettings, invalidate, wrapper } = arrangeSettings({ cached: { searchShortcut: true } });
        patchSettings.mockResolvedValue({ searchShortcut: false });
        const { result } = renderHook(() => useMutation(profileMutations(client).patchSettings()), { wrapper });

        result.current.mutate({ searchShortcut: false });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(invalidate).not.toHaveBeenCalledWith({ queryKey: profileServiceKeys.me });
    });
});
