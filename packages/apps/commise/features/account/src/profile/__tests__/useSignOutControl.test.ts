/**
 * The sign-out control's own state (busy, failed), once for both apps — it was a copy of the same ten lines in web's
 * `LogoutButton` and mobile's `SignOutButton`.
 *
 * Three rules: a failure is surfaced, never swallowed, and releases the busy state so the control is retryable (B17); a
 * retry clears the old failure; and a SUCCESS deliberately leaves the control busy — the session is gone and the app
 * replaces this tree, so clearing it first would flash an idle control.
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useSignOutControl } from '../useSignOutControl.js';

describe('useSignOutControl', () => {
    it('starts idle', () => {
        const { result } = renderHook(() => useSignOutControl(async () => undefined));

        expect(result.current.busy).toBe(false);
        expect(result.current.failed).toBe(false);
    });

    it('is busy while the sign-out runs, and stays busy after it succeeds', async () => {
        let finish: () => void = () => undefined;
        const { result } = renderHook(() =>
            useSignOutControl(() => new Promise<void>((resolve) => (finish = resolve))),
        );

        act(() => result.current.run());
        expect(result.current.busy).toBe(true);

        await act(async () => finish());
        expect(result.current.busy).toBe(true);
        expect(result.current.failed).toBe(false);
    });

    it('surfaces a failed sign-out and releases the busy state so it can be retried', async () => {
        const signOut = vi.fn(async () => Promise.reject(new Error('stuck')));
        const { result } = renderHook(() => useSignOutControl(signOut));

        await act(async () => result.current.run());

        expect(result.current.failed).toBe(true);
        expect(result.current.busy).toBe(false);
    });

    it('clears the earlier failure when it is retried', async () => {
        const signOut = vi.fn().mockRejectedValueOnce(new Error('stuck')).mockResolvedValueOnce(undefined);
        const { result } = renderHook(() => useSignOutControl(signOut));

        await act(async () => result.current.run());
        await act(async () => result.current.run());

        expect(signOut).toHaveBeenCalledTimes(2);
        expect(result.current.failed).toBe(false);
    });
});
