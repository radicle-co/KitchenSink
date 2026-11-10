// @vitest-environment jsdom
/**
 * `useFoodPage` (orchestration): the food and its newest request become a page state; Ask, Withdraw and the edit hand-off
 * are the cook's intents. Real TanStack Query over a fake food client: the hook's behaviour is what is under test, not
 * the client (which `publication.test.ts` covers on the wire).
 */
import { FoodServiceProvider } from '@kitchensink/food-service-client/hooks';
import { NotFoundError, type FoodServiceClient } from '@kitchensink/food-service-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeFood, makeRequest } from '../__fixtures__/foodPageFixtures.js';
import { useFoodPage } from '../useFoodPage.js';

const show = vi.hoisted(() => vi.fn());

vi.mock('@commise/ui/snackbar', () => ({ useSnackbar: () => ({ show }) }));

afterEach(() => {
    cleanup();
    show.mockReset();
});

function setup(client: Partial<FoodServiceClient>, offline = false) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { readonly children: ReactNode }) =>
        createElement(
            QueryClientProvider,
            { client: queryClient },
            createElement(FoodServiceProvider, { client: client as FoodServiceClient, subject: 'user_a', children }),
        );

    return { ...renderHook(() => useFoodPage('food_1', { offline }), { wrapper }) };
}

const resolved = (word: 'private' | 'asked' | 'public' | 'notApproved') => ({
    status: 'RESOLVED' as const,
    food: makeFood({ publicationState: word }),
});

describe('useFoodPage', () => {
    it('is loading until the read lands, then the author state', async () => {
        const { result } = setup({ getById: vi.fn().mockResolvedValue(resolved('private')) });

        expect(result.current.state.kind).toBe('loading');
        await waitFor(() => expect(result.current.state.kind).toBe('private'));
    });

    it('a NotFoundError is the not-found state', async () => {
        const { result } = setup({ getById: vi.fn().mockRejectedValue(new NotFoundError('food_1')) });

        await waitFor(() => expect(result.current.state.kind).toBe('notFound'));
    });

    it('reads the newest request only for a state that needs it', async () => {
        const getPublicationRequest = vi.fn().mockResolvedValue(makeRequest());
        const { result } = setup({ getById: vi.fn().mockResolvedValue(resolved('private')), getPublicationRequest });

        await waitFor(() => expect(result.current.state.kind).toBe('private'));
        expect(getPublicationRequest).not.toHaveBeenCalled();
    });

    it('a declined state carries the request, so the reason can be shown', async () => {
        const detail = makeRequest();
        const { result } = setup({
            getById: vi.fn().mockResolvedValue(resolved('notApproved')),
            getPublicationRequest: vi.fn().mockResolvedValue(detail),
        });

        await waitFor(() => expect(result.current.state).toMatchObject({ kind: 'notApproved', request: detail }));
    });

    it('Ask sends the request, says so politely, and moves to the asked state on the refetch', async () => {
        const getById = vi.fn().mockResolvedValueOnce(resolved('private')).mockResolvedValue(resolved('asked'));
        const requestPublication = vi.fn().mockResolvedValue(makeRequest({ status: 'pending', declineReason: null }));
        const { result } = setup({
            getById,
            requestPublication,
            getPublicationRequest: vi.fn().mockResolvedValue(makeRequest({ status: 'pending', declineReason: null })),
        });

        await waitFor(() => expect(result.current.state.kind).toBe('private'));
        await act(async () => {
            result.current.onAsk();
        });

        expect(requestPublication).toHaveBeenCalledWith('food_1');
        await waitFor(() => expect(result.current.state.kind).toBe('asked'));
        expect(show).toHaveBeenCalledWith({ message: 'Asked to make public.' });
        expect(result.current.ask).toBe('idle');
    });

    it('a failed Ask is reported inline and the page keeps its state', async () => {
        const { result } = setup({
            getById: vi.fn().mockResolvedValue(resolved('private')),
            requestPublication: vi.fn().mockRejectedValue(new Error('boom')),
        });

        await waitFor(() => expect(result.current.state.kind).toBe('private'));
        await act(async () => {
            result.current.onAsk();
        });

        await waitFor(() => expect(result.current.ask).toBe('failed'));
        expect(result.current.state.kind).toBe('private');
        expect(show).not.toHaveBeenCalled();
    });

    it('Withdraw opens the confirmation, Keep closes it without sending, confirm sends and closes', async () => {
        const deleteAuthoredFood = vi.fn().mockResolvedValue(undefined);
        const { result } = setup({ getById: vi.fn().mockResolvedValue(resolved('public')), deleteAuthoredFood });

        await waitFor(() => expect(result.current.state.kind).toBe('public'));
        act(() => result.current.onWithdraw());
        expect(result.current.withdraw.open).toBe(true);
        act(() => result.current.onWithdrawKeep());
        expect(result.current.withdraw.open).toBe(false);
        expect(deleteAuthoredFood).not.toHaveBeenCalled();

        act(() => result.current.onWithdraw());
        await act(async () => {
            result.current.onWithdrawConfirm();
        });

        expect(deleteAuthoredFood).toHaveBeenCalledWith('food_1');
        await waitFor(() => expect(result.current.withdraw.open).toBe(false));
        expect(show).toHaveBeenCalledWith({ message: 'Food withdrawn.' });
    });

    it('a failed Withdraw keeps the dialog open and says so', async () => {
        const { result } = setup({
            getById: vi.fn().mockResolvedValue(resolved('public')),
            deleteAuthoredFood: vi.fn().mockRejectedValue(new Error('boom')),
        });

        await waitFor(() => expect(result.current.state.kind).toBe('public'));
        act(() => result.current.onWithdraw());
        await act(async () => {
            result.current.onWithdrawConfirm();
        });

        await waitFor(() => expect(result.current.withdraw.failed).toBe(true));
        expect(result.current.withdraw.open).toBe(true);
    });

    it('Edit opens the edit form, and there is nothing to edit before the food is read', async () => {
        const { result } = setup({ getById: vi.fn().mockResolvedValue(resolved('private')) });

        act(() => result.current.onEdit());
        expect(result.current.edit.open).toBe(false);
        await waitFor(() => expect(result.current.state.kind).toBe('private'));
        act(() => result.current.onEdit());
        expect(result.current.edit.open).toBe(true);
    });

    it('the host says offline: a cached copy keeps reading with its actions disabled', async () => {
        const { result } = setup({ getById: vi.fn().mockResolvedValue(resolved('private')) }, true);

        await waitFor(() => expect(result.current.state).toMatchObject({ kind: 'private', actionsDisabled: true }));
    });

    it('the host says offline: a failed read with no copy is the offline state, not an error', async () => {
        const { result } = setup({ getById: vi.fn().mockRejectedValue(new Error('network')) }, true);

        await waitFor(() => expect(result.current.state.kind).toBe('offline'));
    });

    it('the host says online: a cached copy has its actions', async () => {
        const { result } = setup({ getById: vi.fn().mockResolvedValue(resolved('private')) });

        await waitFor(() => expect(result.current.state).toMatchObject({ kind: 'private', actionsDisabled: false }));
    });

    it('Retry reads the food again', async () => {
        const getById = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue(resolved('private'));
        const { result } = setup({ getById });

        await waitFor(() => expect(result.current.state.kind).toBe('error'));
        await act(async () => {
            result.current.onRetry();
        });

        await waitFor(() => expect(result.current.state.kind).toBe('private'));
    });
});
