/**
 * The account-erasure SEQUENCE — recipe step, then account step, then sign-out — run as ONE TanStack mutation.
 *
 * Why one mutation (review finding P1 #3): the steps used to be chained through `onSuccess` observer callbacks,
 * and TanStack drops those once the component unmounts. A browser Back or a route change during the recipe step
 * therefore erased the recipes and then never deleted the account or ended the session. `mutationFn` runs to
 * completion after unmount; these tests unmount mid-sequence to prove it, and prove the ordering and which step
 * failed.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    ErasureStepError,
    isErasureStepError,
    useErasureSequence,
    type RecipeErasureInput,
} from '../erasureSequence.js';

afterEach(cleanup);

const input: RecipeErasureInput = { confirmationPhrase: 'ERASE MY DATA', publishRecipeIds: ['r1'] };

/** Stands in for the recipe service's `410 ALREADY_ERASED`; the platform's predicate recognises it. */
const alreadyErased = new Error('410 Account has already been erased');

function deferred<T = void>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
        resolve = res;
    });

    return { promise, resolve };
}

function arrange() {
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const wrapper = ({ children }: { readonly children: ReactNode }) =>
        createElement(QueryClientProvider, { client: queryClient }, children);
    const calls: string[] = [];
    const steps = {
        eraseRecipes: vi.fn(async (_input: RecipeErasureInput) => {
            calls.push('recipes');
        }),
        eraseAccount: vi.fn(async () => {
            calls.push('account');
        }),
        leave: vi.fn(async () => {
            calls.push('leave');
        }),
        recipesAlreadyErased: (error: unknown) => error === alreadyErased,
    };

    return { wrapper, steps, calls };
}

describe('useErasureSequence', () => {
    it('runs recipes, then account, then leave, in that order, passing the input to the recipe step', async () => {
        const { wrapper, steps, calls } = arrange();
        const { result } = renderHook(() => useErasureSequence(steps), { wrapper });

        act(() => result.current.mutate(input));

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(calls).toEqual(['recipes', 'account', 'leave']);
        expect(steps.eraseRecipes).toHaveBeenCalledWith(input);
    });

    it('is pending through the sign-out, not only the two erasure steps', async () => {
        const { wrapper, steps } = arrange();
        const gate = deferred();
        steps.leave.mockReturnValue(gate.promise);
        const { result } = renderHook(() => useErasureSequence(steps), { wrapper });

        act(() => result.current.mutate(input));

        await waitFor(() => expect(steps.leave).toHaveBeenCalled());
        expect(result.current.isPending).toBe(true);
        await act(async () => gate.resolve());
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });

    it('still runs the account step and the sign-out when the form UNMOUNTS during the recipe step', async () => {
        const { wrapper, steps, calls } = arrange();
        const recipeStep = deferred();
        steps.eraseRecipes.mockImplementation(async () => {
            await recipeStep.promise;
            calls.push('recipes');
        });
        const { result, unmount } = renderHook(() => useErasureSequence(steps), { wrapper });

        act(() => result.current.mutate(input));
        await waitFor(() => expect(steps.eraseRecipes).toHaveBeenCalled());
        unmount();
        await act(async () => recipeStep.resolve());

        await waitFor(() => expect(steps.leave).toHaveBeenCalledTimes(1));
        expect(calls).toEqual(['recipes', 'account', 'leave']);
    });

    it('stops before the account step when the recipe step fails, and names the step', async () => {
        const { wrapper, steps } = arrange();
        steps.eraseRecipes.mockRejectedValue(new Error('503'));
        const { result } = renderHook(() => useErasureSequence(steps), { wrapper });

        act(() => result.current.mutate(input));

        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(steps.eraseAccount).not.toHaveBeenCalled();
        expect(steps.leave).not.toHaveBeenCalled();
        expect(isErasureStepError(result.current.error, 'recipes')).toBe(true);
        expect(isErasureStepError(result.current.error, 'account')).toBe(false);
    });

    // A retry after an account-step failure re-sends the recipe step. Once the recipe job has COMPLETED the service
    // answers `410 ALREADY_ERASED` rather than `202`, which used to fail the retry at the recipe step and leave the
    // cook no way to reach the account step again. "Already erased" is the recipe step's goal, so it counts as done.
    it('treats an already-erased answer from the recipe step as done and runs the account step and sign-out', async () => {
        const { wrapper, steps, calls } = arrange();
        steps.eraseRecipes.mockRejectedValue(alreadyErased);
        const { result } = renderHook(() => useErasureSequence(steps), { wrapper });

        act(() => result.current.mutate(input));

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(calls).toEqual(['account', 'leave']);
    });

    it('stops before the sign-out when the account step fails, and names the step', async () => {
        const { wrapper, steps } = arrange();
        steps.eraseAccount.mockRejectedValue(new Error('500'));
        const { result } = renderHook(() => useErasureSequence(steps), { wrapper });

        act(() => result.current.mutate(input));

        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(steps.leave).not.toHaveBeenCalled();
        expect(isErasureStepError(result.current.error, 'account')).toBe(true);
    });

    it('reports a failed sign-out as the exit step, keeping the cause', async () => {
        const { wrapper, steps } = arrange();
        const cause = new Error('sign-out did not take effect');
        steps.leave.mockRejectedValue(cause);
        const { result } = renderHook(() => useErasureSequence(steps), { wrapper });

        act(() => result.current.mutate(input));

        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(isErasureStepError(result.current.error, 'exit')).toBe(true);
        expect((result.current.error as ErasureStepError).cause).toBe(cause);
    });

    it('does not treat an unrelated error as a step error', () => {
        expect(isErasureStepError(new Error('x'), 'exit')).toBe(false);
        expect(isErasureStepError(undefined, 'exit')).toBe(false);
    });
});
