/**
 * Tests for {@link useSourceLimit} — the cook's own limit on source lookups, held ONCE for a session
 * (`docs/design/rowEditorOpenDecisions.md` item 10, system change 9). A per-answer state would forget it at the next
 * keystroke, so every surface that spends the budget reads this one holder. Its pure rules are
 * `sourceLimit.model.test.ts`'s.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useSourceLimit } from '../useSourceLimit.js';

afterEach(() => {
    vi.useRealTimers();
});

const T0 = Date.UTC(2026, 9, 2, 12, 0, 0);

describe('useSourceLimit', () => {
    it('lets the limit go at the held time, so a surface needs no clock to stop reading it', () => {
        vi.useFakeTimers({ now: T0 });
        const { result } = renderHook(() => useSourceLimit());

        act(() => result.current.hold(T0 + 60_000));
        act(() => {
            vi.advanceTimersByTime(59_999);
        });
        expect(result.current.retryAt).toBe(T0 + 60_000);

        act(() => {
            vi.advanceTimersByTime(1);
        });
        expect(result.current.retryAt).toBeUndefined();
    });

    it('holds nothing at first, then the time it is told', () => {
        const { result } = renderHook(() => useSourceLimit());

        expect(result.current.retryAt).toBeUndefined();

        act(() => result.current.hold(T0 + 60_000));
        expect(result.current.retryAt).toBe(T0 + 60_000);
    });

    it('keeps the LATER of two times: an earlier answer arriving late cannot shorten a limit', () => {
        const { result } = renderHook(() => useSourceLimit());

        act(() => result.current.hold(T0 + 120_000));
        act(() => result.current.hold(T0 + 60_000));

        expect(result.current.retryAt).toBe(T0 + 120_000);
    });

    it('is the same object until the limit changes, so a consumer can depend on it', () => {
        const { result, rerender } = renderHook(() => useSourceLimit());
        const first = result.current;

        rerender();
        expect(result.current).toBe(first);
    });
});
