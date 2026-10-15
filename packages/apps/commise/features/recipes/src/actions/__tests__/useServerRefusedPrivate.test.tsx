/**
 * {@link useServerRefusedPrivate} — a Private the server refused AFTER it was sent (plan 2026-10-14-009, the stuck-save
 * review). The client withholds a Private it knows will be refused (`privateRefusalOf`), but an unknown state (a failed
 * profile read) or a stale one (a role removed under a cached profile) sends it, and the editor's follow-up lands after
 * the editor has gone. The recipe page reads the latest visibility write for its recipe from the mutation cache, so the
 * refusal is said there rather than nowhere.
 */
import { RecipeVisibility } from '@kitchensink/recipe-core';
import { BadRequestError, ForbiddenError } from '@kitchensink/recipe-service-client';
import { RecipeServiceProvider, useSetRecipeVisibility } from '@kitchensink/recipe-service-client/hooks';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { makeRecipeDetail } from '../../__fixtures__/index.js';
import { useServerRefusedPrivate } from '../useServerRefusedPrivate.js';

const REFUSED = new BadRequestError('Free-tier user-created recipes are public-only.', 'INVALID_VISIBILITY');

function mount(recipeId: string) {
    const client = createFakeRecipeServiceClient();
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
            <RecipeServiceProvider client={client}>{children}</RecipeServiceProvider>
        </QueryClientProvider>
    );
    const view = renderHook(() => ({ write: useSetRecipeVisibility(), refused: useServerRefusedPrivate(recipeId) }), {
        wrapper,
    });

    return { ...view, client };
}

describe('useServerRefusedPrivate', () => {
    it('⛔ is true once a Private write for this recipe was refused with INVALID_VISIBILITY', async () => {
        const { result, client } = mount('rec_1');
        vi.spyOn(client, 'setRecipeVisibility').mockRejectedValue(REFUSED);

        act(() => result.current.write.mutate({ id: 'rec_1', visibility: RecipeVisibility.PRIVATE }));

        await waitFor(() => expect(result.current.refused).toBe(true));
    });

    it('is false for another recipe`s refusal', async () => {
        const { result, client } = mount('rec_2');
        vi.spyOn(client, 'setRecipeVisibility').mockRejectedValue(REFUSED);

        act(() => result.current.write.mutate({ id: 'rec_1', visibility: RecipeVisibility.PRIVATE }));
        await waitFor(() => expect(result.current.write.isError).toBe(true));

        expect(result.current.refused).toBe(false);
    });

    it.each([
        ['a transport failure', new Error('network down')],
        ['another refusal', new ForbiddenError('Not yours', 'NOT_OWNER')],
        ['another 400', new BadRequestError('Bad', 'VALIDATION_FAILED')],
    ])('is false for %s — that one keeps the generic "try again"', async (_label, error) => {
        const { result, client } = mount('rec_1');
        vi.spyOn(client, 'setRecipeVisibility').mockRejectedValue(error);

        act(() => result.current.write.mutate({ id: 'rec_1', visibility: RecipeVisibility.PRIVATE }));
        await waitFor(() => expect(result.current.write.isError).toBe(true));

        expect(result.current.refused).toBe(false);
    });

    it('is false again once a later write for the recipe succeeds', async () => {
        const { result, client } = mount('rec_1');
        const setVisibility = vi.spyOn(client, 'setRecipeVisibility').mockRejectedValueOnce(REFUSED);

        act(() => result.current.write.mutate({ id: 'rec_1', visibility: RecipeVisibility.PRIVATE }));
        await waitFor(() => expect(result.current.refused).toBe(true));

        setVisibility.mockResolvedValueOnce(makeRecipeDetail({ id: 'rec_1', visibility: RecipeVisibility.PUBLIC }));
        act(() => result.current.write.mutate({ id: 'rec_1', visibility: RecipeVisibility.PUBLIC }));

        await waitFor(() => expect(result.current.refused).toBe(false));
    });
});
