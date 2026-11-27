/**
 * The once-a-second tick behind the dock's countdown. Mutation lens: a tick that runs while nothing counts down fails
 * the idle row; a tick that never stops fails the stop row; a clock read that is not refreshed on start fails the
 * restart row.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSecondTick } from '../useSecondTick.js';

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-27T10:00:00.000Z'));
});

afterEach(() => {
    vi.useRealTimers();
});

describe('useSecondTick', () => {
    it('returns the clock now, and moves it on once a second while active', () => {
        const { result } = renderHook(({ active }) => useSecondTick(active), { initialProps: { active: true } });
        const start = result.current;

        act(() => {
            vi.advanceTimersByTime(1000);
        });
        expect(result.current).toBe(start + 1000);

        act(() => {
            vi.advanceTimersByTime(2000);
        });
        expect(result.current).toBe(start + 3000);
    });

    it('does not tick while nothing counts down', () => {
        const { result } = renderHook(({ active }) => useSecondTick(active), { initialProps: { active: false } });
        const start = result.current;

        act(() => {
            vi.advanceTimersByTime(5000);
        });

        expect(result.current).toBe(start);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('stops ticking when it goes inactive, and clears its timer', () => {
        const { result, rerender } = renderHook(({ active }) => useSecondTick(active), {
            initialProps: { active: true },
        });

        rerender({ active: false });
        const stopped = result.current;

        act(() => {
            vi.advanceTimersByTime(5000);
        });

        expect(result.current).toBe(stopped);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('reads the clock again as soon as it becomes active, so a paused time is not stale', () => {
        const { result, rerender } = renderHook(({ active }) => useSecondTick(active), {
            initialProps: { active: false },
        });
        const before = result.current;

        vi.setSystemTime(Date.now() + 60_000);
        rerender({ active: true });

        expect(result.current).toBe(before + 60_000);
    });

    it('clears its timer on unmount', () => {
        const { unmount } = renderHook(() => useSecondTick(true));

        unmount();

        expect(vi.getTimerCount()).toBe(0);
    });
});
