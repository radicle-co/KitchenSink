/**
 * The erase row's surface state, once for both apps: closed, open, and "the erasure was accepted but the exit failed".
 * The last one is the point: the dead dialog must be DISMISSED (it would otherwise hold the viewer, and on web trap
 * focus, inside a flow whose account no longer exists) and the recovery shown in its place.
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useAccountEraseControl } from '../useAccountEraseControl.js';

describe('useAccountEraseControl', () => {
    it('starts closed with no exit failure', () => {
        const { result } = renderHook(() => useAccountEraseControl());

        expect(result.current.open).toBe(false);
        expect(result.current.exitFailed).toBe(false);
    });

    it('opens and closes the dialog', () => {
        const { result } = renderHook(() => useAccountEraseControl());

        act(() => result.current.openDialog());
        expect(result.current.open).toBe(true);

        act(() => result.current.closeDialog());
        expect(result.current.open).toBe(false);
    });

    it('dismisses the dead dialog and records the failure when the exit fails after an accepted erasure', () => {
        const { result } = renderHook(() => useAccountEraseControl());

        act(() => result.current.openDialog());
        act(() => result.current.onExitFailed());

        expect(result.current.open).toBe(false);
        expect(result.current.exitFailed).toBe(true);
    });
});
