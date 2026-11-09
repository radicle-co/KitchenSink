// @vitest-environment jsdom
/**
 * The author's publication hooks (ADR-0029): the own-food list is keyed on the cook, an ask or an edit or a withdraw
 * refreshes the food, its request and the list, and the newest request is read whatever its status.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FoodServiceClient } from '../client.js';
import {
    FoodServiceProvider,
    foodServiceKeys,
    useOwnFoods,
    usePublicationRequest,
    useRequestFoodPublication,
    useUpdateAuthoredFood,
    useWithdrawFood,
} from '../hooks.js';

afterEach(cleanup);

const DETAIL = {
    request: {
        id: 'r1',
        foodId: 'f1',
        versionNumber: 1,
        status: 'pending' as const,
        declineReason: null,
        createdAt: '2026-11-09T10:00:00.000Z',
        decidedAt: null,
    },
    snapshot: {
        name: 'Oat',
        description: null,
        macros: { calories: 1, proteinG: 1, carbsG: 1, fatG: 1 },
        portions: [],
    },
};

function render<T>(hook: () => T, client: Partial<FoodServiceClient>) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { readonly children: ReactNode }) =>
        createElement(
            QueryClientProvider,
            { client: queryClient },
            createElement(FoodServiceProvider, { client: client as FoodServiceClient, subject: 'user_a', children }),
        );

    return { ...renderHook(hook, { wrapper }), queryClient };
}

describe('useOwnFoods', () => {
    it('reads the first page and pages with the cursor', async () => {
        const listOwnFoods = vi
            .fn()
            .mockResolvedValueOnce({ items: [{ id: 'a' }], nextCursor: 'c2', unseenDecisions: 2 })
            .mockResolvedValueOnce({ items: [{ id: 'b' }], unseenDecisions: 2 });
        const { result } = render(() => useOwnFoods(), { listOwnFoods });

        await waitFor(() => expect(result.current.data?.pages[0]?.unseenDecisions).toBe(2));
        expect(result.current.hasNextPage).toBe(true);

        await act(async () => {
            await result.current.fetchNextPage();
        });

        expect(listOwnFoods).toHaveBeenLastCalledWith('c2');
        await waitFor(() => expect(result.current.hasNextPage).toBe(false));
    });

    it('is keyed on the cook, so another cook never reads this list', () => {
        expect(foodServiceKeys.ownFoods('user_a')).not.toEqual(foodServiceKeys.ownFoods('user_b'));
    });
});

describe('usePublicationRequest', () => {
    it('reads the newest request for the food', async () => {
        const getPublicationRequest = vi.fn().mockResolvedValue(DETAIL);
        const { result } = render(() => usePublicationRequest('f1'), { getPublicationRequest });

        await waitFor(() => expect(result.current.data).toEqual(DETAIL));
        expect(getPublicationRequest).toHaveBeenCalledWith('f1');
    });

    it('asks nothing when the read is held', () => {
        const getPublicationRequest = vi.fn();
        render(() => usePublicationRequest('f1', { enabled: false }), { getPublicationRequest });

        expect(getPublicationRequest).not.toHaveBeenCalled();
    });
});

describe('the author mutations refresh what they change', () => {
    /** Run one id-taking mutation and list the keys it invalidated. */
    async function invalidatedBy(run: (id: string) => Promise<unknown>, queryClient: QueryClient): Promise<string[]> {
        const spy = vi.spyOn(queryClient, 'invalidateQueries');

        await act(async () => {
            await run('f1');
        });

        return spy.mock.calls.map((call) => JSON.stringify(call[0]?.queryKey));
    }

    const EXPECTED = () => [
        JSON.stringify(foodServiceKeys.food('f1')),
        JSON.stringify(foodServiceKeys.publicationRequest('f1')),
        JSON.stringify(foodServiceKeys.ownFoods('user_a')),
    ];

    it('useRequestFoodPublication invalidates the food, its request and the list', async () => {
        const { result, queryClient } = render(() => useRequestFoodPublication(), {
            requestPublication: vi.fn().mockResolvedValue(DETAIL),
        });

        expect(await invalidatedBy((id) => result.current.mutateAsync(id), queryClient)).toEqual(
            expect.arrayContaining(EXPECTED()),
        );
    });

    it('useWithdrawFood invalidates the food, its request and the list', async () => {
        const { result, queryClient } = render(() => useWithdrawFood(), {
            deleteAuthoredFood: vi.fn().mockResolvedValue(undefined),
        });

        expect(await invalidatedBy((id) => result.current.mutateAsync(id), queryClient)).toEqual(
            expect.arrayContaining(EXPECTED()),
        );
    });

    it('useUpdateAuthoredFood sends the edit for the food and refreshes the same three reads', async () => {
        const updateAuthoredFood = vi.fn().mockResolvedValue({ kind: 'editPending', versionNumber: 2 });
        const { result, queryClient } = render(() => useUpdateAuthoredFood(), { updateAuthoredFood });
        const spy = vi.spyOn(queryClient, 'invalidateQueries');
        const input = { name: 'Oat', macros: { calories: 1, proteinG: 1, carbsG: 1, fatG: 1 } };

        await act(async () => {
            await result.current.mutateAsync({ id: 'f1', input });
        });

        expect(updateAuthoredFood).toHaveBeenCalledWith('f1', input);
        expect(spy).toHaveBeenCalledTimes(3);
    });
});
