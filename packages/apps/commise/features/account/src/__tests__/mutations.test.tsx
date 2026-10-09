/**
 * The ONE profile write both apps make (`PATCH /api/v1/users/me`): web's display-name sheet and mobile's display name
 * and photo all run this mutation, so what it sends and what it refreshes cannot differ between them. Run through a
 * real `useMutation` over a real `QueryClient`, with only the client's transport spied.
 */
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
