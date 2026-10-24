/**
 * The scroller-drag host (`fieldReveal/useScrollerDragHost.native.ts`): the screen's one scroller reports that the cook began a
 * drag, and every field that subscribed hears it (`Combobox` closes an open list on a drag that began outside it).
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useScrollerDragHost } from '../useScrollerDragHost.native.js';

describe('useScrollerDragHost', () => {
    it('tells every subscriber that a drag began, until it unsubscribes', () => {
        const { result } = renderHook(() => useScrollerDragHost());
        const first = vi.fn();
        const second = vi.fn();
        const stopFirst = result.current.subscribe(first);
        result.current.subscribe(second);

        act(() => result.current.onScrollBeginDrag());
        stopFirst();
        act(() => result.current.onScrollBeginDrag());

        expect(first).toHaveBeenCalledTimes(1);
        expect(second).toHaveBeenCalledTimes(2);
    });

    it('keeps one identity for subscribe and the handler, so a subscriber effect does not re-run each render', () => {
        const { result, rerender } = renderHook(() => useScrollerDragHost());
        const { subscribe, onScrollBeginDrag } = result.current;

        rerender();

        expect(result.current.subscribe).toBe(subscribe);
        expect(result.current.onScrollBeginDrag).toBe(onScrollBeginDrag);
    });
});
