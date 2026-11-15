import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LOADING_PHASE_EDGES, loadingPhase, useLoadingPhase } from '../loadingPhase.js';

afterEach(cleanup);

/** Spec S28: nothing for the first 300 ms, the skeleton, "Opening the recipe…" after 1 s, Try again after 10 s. */
describe('loadingPhase', () => {
    it.each([
        [0, 'blank'],
        [299, 'blank'],
        [300, 'skeleton'],
        [999, 'skeleton'],
        [1000, 'label'],
        [9999, 'label'],
        [10_000, 'slow'],
        [60_000, 'slow'],
    ])('after %d ms it is %s', (elapsed, phase) => {
        expect(loadingPhase(elapsed)).toBe(phase);
    });

    it('is blank for an elapsed time it cannot trust', () => {
        expect(loadingPhase(-5)).toBe('blank');
        expect(loadingPhase(Number.NaN)).toBe('blank');
    });

    it('names the three edges once', () => {
        expect(LOADING_PHASE_EDGES).toEqual({ skeleton: 300, label: 1000, slow: 10_000 });
    });
});

describe('useLoadingPhase', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('walks the phases as time passes while the read is in flight', () => {
        const { result } = renderHook(() => useLoadingPhase(true));
        expect(result.current).toBe('blank');

        act(() => {
            vi.advanceTimersByTime(300);
        });
        expect(result.current).toBe('skeleton');

        act(() => {
            vi.advanceTimersByTime(700);
        });
        expect(result.current).toBe('label');

        act(() => {
            vi.advanceTimersByTime(9000);
        });
        expect(result.current).toBe('slow');
    });

    it('stays blank, and sets no timer, when nothing is loading', () => {
        const { result } = renderHook(() => useLoadingPhase(false));

        act(() => {
            vi.advanceTimersByTime(20_000);
        });

        expect(result.current).toBe('blank');
        expect(vi.getTimerCount()).toBe(0);
    });

    it('starts again from blank when a new read begins', () => {
        const { result, rerender } = renderHook(({ active }) => useLoadingPhase(active), {
            initialProps: { active: true },
        });

        act(() => {
            vi.advanceTimersByTime(11_000);
        });
        expect(result.current).toBe('slow');

        rerender({ active: false });
        rerender({ active: true });
        expect(result.current).toBe('blank');

        act(() => {
            vi.advanceTimersByTime(300);
        });
        expect(result.current).toBe('skeleton');
    });

    it('clears its timers when the screen goes away', () => {
        const { unmount } = renderHook(() => useLoadingPhase(true));

        unmount();

        expect(vi.getTimerCount()).toBe(0);
    });
});
