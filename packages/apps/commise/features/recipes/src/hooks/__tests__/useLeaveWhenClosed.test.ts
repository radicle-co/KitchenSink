// @vitest-environment jsdom
/**
 * "Leave only after the sheet has closed" — the ordering both apps' collection detail now share. Written FIRST, from the
 * rule `useLeaveWhenClosed.ts` states (a screen being left is not restyled on the way out) and from the one thing a
 * state-derived effect adds: it
 * must fire ONCE per request to leave, however often the host re-renders with a fresh `leave` closure.
 */
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useLeaveWhenClosed } from '../useLeaveWhenClosed.js';

const setup = (initial: { armed: boolean; open: boolean }) => {
    const leave = vi.fn();
    const view = renderHook(
        (props: { armed: boolean; open: boolean }) => useLeaveWhenClosed(props.armed, props.open, () => leave()),
        {
            initialProps: initial,
        },
    );

    return { leave, ...view };
};

describe('useLeaveWhenClosed', () => {
    it('does not leave while nothing has been asked', () => {
        const { leave } = setup({ armed: false, open: false });

        expect(leave).not.toHaveBeenCalled();
    });

    it('does not leave while the sheet is still open, even once armed', () => {
        const { leave, rerender } = setup({ armed: false, open: true });

        rerender({ armed: true, open: true });

        expect(leave).not.toHaveBeenCalled();
    });

    it('leaves when the sheet has closed after the request', () => {
        const { leave, rerender } = setup({ armed: true, open: true });

        rerender({ armed: true, open: false });

        expect(leave).toHaveBeenCalledTimes(1);
    });

    it('leaves once, however often the host re-renders with a new closure', () => {
        const { leave, rerender } = setup({ armed: true, open: true });

        rerender({ armed: true, open: false });
        rerender({ armed: true, open: false });
        rerender({ armed: true, open: false });

        expect(leave).toHaveBeenCalledTimes(1);
    });

    it('leaves again for a second request after the first was disarmed', () => {
        const { leave, rerender } = setup({ armed: true, open: false });

        rerender({ armed: false, open: false });
        rerender({ armed: true, open: false });

        expect(leave).toHaveBeenCalledTimes(2);
    });
});
