// @vitest-environment jsdom
/**
 * `useFoodEdit` (states 13 and 14): the form opens on the right draft, a private food saves at once, a public food’s edit is
 * sent for review and says so on the 202, nothing is sent when nothing changed, and a failure keeps the draft.
 */
import { ConflictError, type FoodServiceClient } from '@kitchensink/food-service-client';
import { FoodServiceProvider } from '@kitchensink/food-service-client/hooks';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeFood, makeOwnState, makeRequest } from '../__fixtures__/foodPageFixtures.js';
import type { EditableState } from '../foodEditForm.js';
import { useFoodEdit } from '../useFoodEdit.js';

const show = vi.hoisted(() => vi.fn());

vi.mock('@commise/ui/snackbar', () => ({ useSnackbar: () => ({ show }) }));

afterEach(() => {
    cleanup();
    show.mockReset();
});

function setup(state: EditableState, client: Partial<FoodServiceClient>) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { readonly children: ReactNode }) =>
        createElement(
            QueryClientProvider,
            { client: queryClient },
            createElement(FoodServiceProvider, { client: client as FoodServiceClient, subject: 'user_a', children }),
        );

    return renderHook(() => useFoodEdit(state), { wrapper });
}

describe('useFoodEdit', () => {
    it('is closed until opened, then holds the starting draft, the notice and no change yet', () => {
        const { result } = setup(makeOwnState('public', { request: undefined }), {});

        expect(result.current.open).toBe(false);
        act(() => result.current.onOpen());

        expect(result.current.open).toBe(true);
        expect(result.current.draft.calories).toBe('120');
        expect(result.current.notice).toBe('review');
        expect(result.current.unchanged).toBe(true);
    });

    it('⛔ a private food saves at once and says "Food saved."', async () => {
        const updateAuthoredFood = vi.fn().mockResolvedValue({ kind: 'applied', food: makeFood() });
        const { result } = setup(makeOwnState('private', { request: undefined }), { updateAuthoredFood });

        act(() => result.current.onOpen());
        act(() => result.current.onChange('calories', '130'));
        await act(async () => result.current.onSubmit());

        expect(updateAuthoredFood).toHaveBeenCalledWith('food_1', {
            name: 'Oat milk',
            macros: { calories: 130, proteinG: 3, carbsG: 16, fatG: 5 },
        });
        await waitFor(() => expect(result.current.open).toBe(false));
        expect(show).toHaveBeenCalledWith({ message: 'Food saved.' });
    });

    it('⛔ a public food’s edit answers 202 and says "Edit sent for review."', async () => {
        const updateAuthoredFood = vi.fn().mockResolvedValue({ kind: 'editPending', versionNumber: 3 });
        const { result } = setup(makeOwnState('public', { request: undefined }), { updateAuthoredFood });

        act(() => result.current.onOpen());
        act(() => result.current.onChange('fatG', '6'));
        await act(async () => result.current.onSubmit());

        await waitFor(() => expect(show).toHaveBeenCalledWith({ message: 'Edit sent for review.' }));
    });

    it('sends nothing when nothing changed', async () => {
        const updateAuthoredFood = vi.fn();
        const { result } = setup(makeOwnState('public', { request: undefined }), { updateAuthoredFood });

        act(() => result.current.onOpen());
        await act(async () => result.current.onSubmit());

        expect(updateAuthoredFood).not.toHaveBeenCalled();
    });

    it('a bad figure is a field error and sends nothing', async () => {
        const updateAuthoredFood = vi.fn();
        const { result } = setup(makeOwnState('private', { request: undefined }), { updateAuthoredFood });

        act(() => result.current.onOpen());
        act(() => result.current.onChange('calories', 'lots'));
        await act(async () => result.current.onSubmit());

        expect(result.current.fieldErrors.calories).toBe('not_a_number');
        expect(updateAuthoredFood).not.toHaveBeenCalled();
    });

    it('a failed save keeps the sheet open and the draft, and says so', async () => {
        const { result } = setup(makeOwnState('private', { request: undefined }), {
            updateAuthoredFood: vi.fn().mockRejectedValue(new Error('boom')),
        });

        act(() => result.current.onOpen());
        act(() => result.current.onChange('calories', '130'));
        await act(async () => result.current.onSubmit());

        await waitFor(() => expect(result.current.failed).toBe(true));
        expect(result.current.open).toBe(true);
        expect(result.current.draft.calories).toBe('130');
    });

    it('a name the cook already used is its own line, not the generic failure', async () => {
        const { result } = setup(makeOwnState('private', { request: undefined }), {
            updateAuthoredFood: vi.fn().mockRejectedValue(new ConflictError('dup')),
        });

        act(() => result.current.onOpen());
        act(() => result.current.onChange('name', 'Other'));
        await act(async () => result.current.onSubmit());

        await waitFor(() => expect(result.current.duplicate).toBe(true));
        expect(result.current.failed).toBe(false);
    });

    it('opens a waiting edit on the waiting version', () => {
        const { result } = setup(
            makeOwnState('editWaiting', { request: makeRequest({ status: 'pending', declineReason: null }) }),
            {},
        );

        act(() => result.current.onOpen());

        expect(result.current.draft.calories).toBe('135');
        expect(result.current.notice).toBe('replacesWaiting');
    });

    it('Cancel closes without sending', () => {
        const updateAuthoredFood = vi.fn();
        const { result } = setup(makeOwnState('private', { request: undefined }), { updateAuthoredFood });

        act(() => result.current.onOpen());
        act(() => result.current.onCancel());

        expect(result.current.open).toBe(false);
        expect(updateAuthoredFood).not.toHaveBeenCalled();
    });
});
