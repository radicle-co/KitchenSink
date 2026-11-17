import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DONE_SETTLE_MS, useDoneSettled } from '../doneSettle.js';

afterEach(cleanup);

/** S24: Done ignores a press for the first 400 ms, so the tap that finished the recipe cannot also pick an action. */
describe('useDoneSettled', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('names the window once', () => {
        expect(DONE_SETTLE_MS).toBe(400);
    });

    it('is false at 0 and at 399 ms, and true at 400 ms, once the cook has finished', () => {
        const { result } = renderHook(() => useDoneSettled(true));

        expect(result.current).toBe(false);

        act(() => {
            vi.advanceTimersByTime(399);
        });
        expect(result.current).toBe(false);

        act(() => {
            vi.advanceTimersByTime(1);
        });
        expect(result.current).toBe(true);
    });

    it('is settled while the cook has not finished, so a step never waits', () => {
        const { result } = renderHook(() => useDoneSettled(false));

        expect(result.current).toBe(true);
    });

    it('waits again when Done is reached a second time', () => {
        const { result, rerender } = renderHook(({ finished }) => useDoneSettled(finished), {
            initialProps: { finished: true },
        });

        act(() => {
            vi.advanceTimersByTime(400);
        });
        expect(result.current).toBe(true);

        rerender({ finished: false });
        expect(result.current).toBe(true);

        rerender({ finished: true });
        expect(result.current).toBe(false);

        act(() => {
            vi.advanceTimersByTime(399);
        });
        expect(result.current).toBe(false);

        act(() => {
            vi.advanceTimersByTime(1);
        });
        expect(result.current).toBe(true);
    });

    it('clears its timer when the screen goes away', () => {
        const { unmount } = renderHook(() => useDoneSettled(true));

        unmount();

        expect(vi.getTimerCount()).toBe(0);
    });
});
