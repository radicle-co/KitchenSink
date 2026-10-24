/**
 * The account-CLOSURE sequence — close step, then sign-out — run as ONE TanStack mutation, mirroring the erasure
 * sequence (`erasureSequence.test.tsx`) for the same reason: an observer callback is dropped when the component
 * unmounts, so a closure chained through `onSuccess` could close the account and never end the session.
 * `buildSpec.md` §9.1 "Close account when the sign-out fails". These tests unmount mid-sequence to prove it, and
 * prove which step failed, because a failed `exit` means the account IS closed and a retry of the close is a lie.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ErasureStepError } from '../erasureSequence.js';
import { ClosureStepError, isClosureStepError, useClosureSequence } from '../closureSequence.js';

afterEach(cleanup);

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
        close: vi.fn(async () => {
            calls.push('close');
        }),
        leave: vi.fn(async () => {
            calls.push('leave');
        }),
    };

    return { wrapper, steps, calls };
}

describe('useClosureSequence', () => {
    it('runs close, then leave, in that order', async () => {
        const { wrapper, steps, calls } = arrange();
        const { result } = renderHook(() => useClosureSequence(steps), { wrapper });

        act(() => result.current.mutate());

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(calls).toEqual(['close', 'leave']);
    });

    it('is pending through the sign-out, not only the close step', async () => {
        const { wrapper, steps } = arrange();
        const gate = deferred();
        steps.leave.mockReturnValue(gate.promise);
        const { result } = renderHook(() => useClosureSequence(steps), { wrapper });

        act(() => result.current.mutate());

        await waitFor(() => expect(steps.leave).toHaveBeenCalled());
        expect(result.current.isPending).toBe(true);
        await act(async () => gate.resolve());
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });

    it('still runs the sign-out when the control UNMOUNTS during the close step', async () => {
        const { wrapper, steps, calls } = arrange();
        const closeStep = deferred();
        steps.close.mockImplementation(async () => {
            await closeStep.promise;
            calls.push('close');
        });
        const { result, unmount } = renderHook(() => useClosureSequence(steps), { wrapper });

        act(() => result.current.mutate());
        await waitFor(() => expect(steps.close).toHaveBeenCalled());
        unmount();
        await act(async () => closeStep.resolve());

        await waitFor(() => expect(steps.leave).toHaveBeenCalledTimes(1));
        expect(calls).toEqual(['close', 'leave']);
    });

    it('stops before the sign-out when the close step fails, and names the step', async () => {
        const { wrapper, steps } = arrange();
        steps.close.mockRejectedValue(new Error('503'));
        const { result } = renderHook(() => useClosureSequence(steps), { wrapper });

        act(() => result.current.mutate());

        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(steps.leave).not.toHaveBeenCalled();
        expect(isClosureStepError(result.current.error, 'close')).toBe(true);
        expect(isClosureStepError(result.current.error, 'exit')).toBe(false);
    });

    it('reports a failed sign-out as the exit step, keeping the cause', async () => {
        const { wrapper, steps } = arrange();
        const cause = new Error('sign-out did not take effect');
        steps.leave.mockRejectedValue(cause);
        const { result } = renderHook(() => useClosureSequence(steps), { wrapper });

        act(() => result.current.mutate());

        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(isClosureStepError(result.current.error, 'exit')).toBe(true);
        expect((result.current.error as ClosureStepError).cause).toBe(cause);
    });

    it('does not treat an unrelated error, or an erasure step error, as a closure step error', () => {
        expect(isClosureStepError(new Error('x'), 'exit')).toBe(false);
        expect(isClosureStepError(undefined, 'exit')).toBe(false);
        expect(isClosureStepError(new ErasureStepError('exit', new Error('x')), 'exit')).toBe(false);
    });
});
