/**
 * Tests for {@link useDebouncedValue} — the shared generic debounce hook backing the ingredient typeahead's
 * REQ-057 debounce window. No DOM, no client hooks: purely a `setTimeout`-driven state transition, so it's
 * tested with fake timers rather than a rendered component.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDebouncedValue } from '../useDebouncedValue.js';

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('useDebouncedValue', () => {
    it('returns the initial value immediately, before any delay elapses', () => {
        const { result } = renderHook(() => useDebouncedValue('a', 300));

        expect(result.current).toBe('a');
    });

    it('does not update until the delay elapses', () => {
        const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 300), {
            initialProps: { value: 'a' },
        });

        rerender({ value: 'ab' });
        act(() => {
            vi.advanceTimersByTime(299);
        });

        expect(result.current).toBe('a');
    });

    it('updates to the latest value once the delay elapses', () => {
        const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 300), {
            initialProps: { value: 'a' },
        });

        rerender({ value: 'ab' });
        act(() => {
            vi.advanceTimersByTime(300);
        });

        expect(result.current).toBe('ab');
    });

    it('collapses rapid changes into a single settle on the LAST value (no intermediate flicker)', () => {
        const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 300), {
            initialProps: { value: 'a' },
        });

        rerender({ value: 'ab' });
        act(() => {
            vi.advanceTimersByTime(100);
        });
        rerender({ value: 'abc' });
        act(() => {
            vi.advanceTimersByTime(100);
        });
        rerender({ value: 'abcd' });

        // Neither intermediate value ever settled — each rerender restarted the 300ms window.
        act(() => {
            vi.advanceTimersByTime(299);
        });
        expect(result.current).toBe('a');

        act(() => {
            vi.advanceTimersByTime(1);
        });
        expect(result.current).toBe('abcd');
    });
});
