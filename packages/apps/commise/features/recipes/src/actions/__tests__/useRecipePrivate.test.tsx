/**
 * {@link useRecipePrivate} - what a recipe surface needs to decide Private (ADR-0073): the recipe's rule, the cook's slot
 * standing from the server's read, and the refusal that is KNOWN (what the editor must not send).
 *
 * Written before the hook. The standing is read from `GET /api/v1/recipes/private-slots` and is a DISPLAY fact: a read that
 * is loading or failed is never a refusal.
 */
import { RecipeSourceType } from '@kitchensink/recipe-core';
import { UnauthorizedError } from '@kitchensink/recipe-service-client';
import { RecipeServiceProvider } from '@kitchensink/recipe-service-client/hooks';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useRecipePrivate } from '../useRecipePrivate.js';

function mount(
    usage: 'limited-open' | 'limited-full' | 'unlimited' | 'fail',
    sourceType: RecipeSourceType | undefined = undefined,
    known: 'granted' | 'upsell' | 'hidden' | undefined = 'upsell',
) {
    const client = createFakeRecipeServiceClient();
    const getPrivateSlots = vi.spyOn(client, 'getPrivateSlots');

    if (usage === 'fail') {
        getPrivateSlots.mockRejectedValue(new UnauthorizedError('no', 'UNAUTHORIZED'));
    } else if (usage === 'unlimited') {
        getPrivateSlots.mockResolvedValue({ kind: 'unlimited' });
    } else {
        getPrivateSlots.mockResolvedValue({ kind: 'limited', used: usage === 'limited-full' ? 50 : 12, limit: 50 });
    }

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
            <RecipeServiceProvider client={client}>{children}</RecipeServiceProvider>
        </QueryClientProvider>
    );
    const view = renderHook(() => useRecipePrivate({ sourceType, knownPaidFeatures: known }), { wrapper });

    return { ...view, getPrivateSlots };
}

describe('useRecipePrivate', () => {
    it('is loading until the server answers, and then open with the server`s numbers', async () => {
        const { result } = mount('limited-open');

        expect(result.current.standing).toEqual({ kind: 'loading' });

        await waitFor(() => expect(result.current.standing.kind).toBe('open'));
        expect(result.current.standing).toEqual({ kind: 'open', used: 12, limit: 50, left: 38 });
        expect(result.current.refusal).toBeUndefined();
    });

    it('⛔ a full standing is a KNOWN refusal of Private: the editor must not send one', async () => {
        const { result } = mount('limited-full');

        await waitFor(() => expect(result.current.standing.kind).toBe('full'));
        expect(result.current.refusal).toBe('slots');
    });

    it('Pro is unlimited and refuses nothing', async () => {
        const { result } = mount('unlimited', undefined, 'granted');

        await waitFor(() => expect(result.current.standing.kind).toBe('unlimited'));
        expect(result.current.refusal).toBeUndefined();
    });

    it('⛔ a FAILED read is unknown and refuses nothing: the server decides the write', async () => {
        const { result } = mount('fail');

        await waitFor(() => expect(result.current.standing.kind).toBe('unknown'));
        expect(result.current.refusal).toBeUndefined();
    });

    it('a recipe never saved, and every label but imported_public, is counted against the slots', async () => {
        const cases = [
            [undefined, 'slots'],
            [RecipeSourceType.USER_CREATED, 'slots'],
            // A book or paid-site recipe uses a slot too but can never go public: its own rule (ADR-0073 sections 4 and 7).
            [RecipeSourceType.IMPORTED_PHYSICAL, 'privateOnly'],
            [RecipeSourceType.IMPORTED_PAID, 'privateOnly'],
        ] as const;

        for (const [sourceType, rule] of cases) {
            const { result } = mount('limited-full', sourceType);

            expect(result.current.rule).toBe(rule);
            await waitFor(() => expect(result.current.refusal).toBe('slots'));
        }
    });

    it('an imported public-web recipe is under the premium rule: its refusal is the paid-feature one, whatever the count', async () => {
        const { result, getPrivateSlots } = mount('limited-full', RecipeSourceType.IMPORTED_PUBLIC, 'upsell');

        expect(result.current.rule).toBe('premium');
        expect(result.current.refusal).toBe('premium');
        // The count plays no part in that rule, so it is not even asked.
        await Promise.resolve();
        expect(getPrivateSlots).not.toHaveBeenCalled();
    });
});
