/**
 * {@link useServerRefusedPrivate} — a Private the server refused AFTER it was sent (plan 2026-10-14-009, the stuck-save
 * review). The client withholds a Private it knows will be refused (`privateRefusalOf`), but an unknown state (a failed
 * profile read) or a stale one (a role removed under a cached profile) sends it, and the editor's follow-up lands after
 * the editor has gone. The recipe page reads the latest visibility write for its recipe from the mutation cache, so the
 * refusal is said there rather than nowhere.
 */
import type { PaidFeatureState } from '@commise/features-account';
import { RecipeVisibility } from '@kitchensink/recipe-core';
import { BadRequestError, ForbiddenError } from '@kitchensink/recipe-service-client';
import {
    RECIPE_VISIBILITY_MUTATION_KEY,
    RecipeServiceProvider,
    useSetRecipeVisibility,
} from '@kitchensink/recipe-service-client/hooks';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { makeRecipeDetail } from '../../__fixtures__/index.js';
import { useServerRefusedPrivate } from '../useServerRefusedPrivate.js';

const REFUSED = new BadRequestError('Free-tier user-created recipes are public-only.', 'INVALID_VISIBILITY');

function mount(recipeId: string, known: PaidFeatureState | undefined = undefined) {
    const client = createFakeRecipeServiceClient();
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
            <RecipeServiceProvider client={client}>{children}</RecipeServiceProvider>
        </QueryClientProvider>
    );
    const view = renderHook(
        () => ({ write: useSetRecipeVisibility(), refused: useServerRefusedPrivate(recipeId, known) }),
        {
            wrapper,
        },
    );

    return { ...view, client, queryClient };
}

describe('useServerRefusedPrivate', () => {
    // The page used to rebuild the words' key from the profile at each of its two call sites
    // (`privateRefusalOf(known ?? 'loading') ?? 'final'`); the hook answers it, so the two cannot disagree.
    it.each<[string, PaidFeatureState | undefined, 'final' | 'premium']>([
        ['an unknown profile (a failed read): final, the server said no', undefined, 'final'],
        ['a role removed under a cached `granted` profile: final', 'granted', 'final'],
        ['a viewer who would be offered Premium: premium', 'upsell', 'premium'],
        ['a viewer the gate hides it from: final', 'hidden', 'final'],
    ])(
        '⛔ answers WHY once a Private write for this recipe was refused with INVALID_VISIBILITY: %s',
        async (_l, known, why) => {
            const { result, client } = mount('rec_1', known);
            vi.spyOn(client, 'setRecipeVisibility').mockRejectedValue(REFUSED);

            act(() => result.current.write.mutate({ id: 'rec_1', visibility: RecipeVisibility.PRIVATE }));

            await waitFor(() => expect(result.current.refused).toBe(why));
        },
    );

    it('is undefined for another recipe`s refusal', async () => {
        const { result, client } = mount('rec_2');
        vi.spyOn(client, 'setRecipeVisibility').mockRejectedValue(REFUSED);

        act(() => result.current.write.mutate({ id: 'rec_1', visibility: RecipeVisibility.PRIVATE }));
        await waitFor(() => expect(result.current.write.isError).toBe(true));

        expect(result.current.refused).toBeUndefined();
    });

    it.each([
        ['a transport failure', new Error('network down')],
        ['another refusal', new ForbiddenError('Not yours', 'NOT_OWNER')],
        ['another 400', new BadRequestError('Bad', 'VALIDATION_FAILED')],
    ])('is undefined for %s — that one keeps the generic "try again"', async (_label, error) => {
        const { result, client } = mount('rec_1');
        vi.spyOn(client, 'setRecipeVisibility').mockRejectedValue(error);

        act(() => result.current.write.mutate({ id: 'rec_1', visibility: RecipeVisibility.PRIVATE }));
        await waitFor(() => expect(result.current.write.isError).toBe(true));

        expect(result.current.refused).toBeUndefined();
    });

    it('is undefined again once a later write for the recipe succeeds', async () => {
        const { result, client } = mount('rec_1');
        const setVisibility = vi.spyOn(client, 'setRecipeVisibility').mockRejectedValueOnce(REFUSED);

        act(() => result.current.write.mutate({ id: 'rec_1', visibility: RecipeVisibility.PRIVATE }));
        await waitFor(() => expect(result.current.refused).toBe('final'));

        setVisibility.mockResolvedValueOnce(makeRecipeDetail({ id: 'rec_1', visibility: RecipeVisibility.PUBLIC }));
        act(() => result.current.write.mutate({ id: 'rec_1', visibility: RecipeVisibility.PUBLIC }));

        await waitFor(() => expect(result.current.refused).toBeUndefined());
    });

    // The cache holds every mutation's variables as `unknown`; an entry under our key that is not our variables (a
    // second writer, a stale shape) must read as "not ours", never throw and never count as a refusal.
    it.each<[string, unknown]>([
        ['no variables', undefined],
        ['a non-object', 'rec_1'],
        ['an id that is not a string', { id: 1, visibility: RecipeVisibility.PRIVATE }],
        ['a visibility that is not one of ours', { id: 'rec_1', visibility: 'unlisted' }],
        ['no visibility', { id: 'rec_1' }],
    ])('ignores a cached write with %s', async (_label, variables) => {
        const { result, queryClient } = mount('rec_1');

        await act(async () => {
            await queryClient
                .getMutationCache()
                .build(queryClient, {
                    mutationKey: RECIPE_VISIBILITY_MUTATION_KEY,
                    mutationFn: () => Promise.reject(REFUSED),
                })
                .execute(variables)
                .catch(() => undefined);
        });

        expect(result.current.refused).toBeUndefined();
    });
});
