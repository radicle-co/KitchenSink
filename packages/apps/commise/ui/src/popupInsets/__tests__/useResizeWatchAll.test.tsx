// @vitest-environment jsdom
/**
 * `useResizeWatchAll`: ONE watch over several nodes, for a page whose entry depends on more than one box (the shell's
 * tab bar and its `<main>` column: at the width the sidebar shows the tab bar is hidden and a sidebar collapse resizes
 * only `<main>`). It observes each node that exists by its border box, tells the caller when any resizes, and one stop
 * disconnects them all. Written before the hook.
 */
import { resizeObserver, reportResize } from '../../testing/resizeObserver.js';

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useResizeWatchAll } from '../useResizeWatchAll.js';

afterEach(() => {
    cleanup();
    resizeObserver.observed.clear();
    resizeObserver.options.clear();
});

describe('useResizeWatchAll', () => {
    it('has no watch while no node exists', () => {
        const { result } = renderHook(() => useResizeWatchAll([null, null]));

        expect(result.current).toBeUndefined();
    });

    it('observes every node that exists, by its border box, and tells the caller when any resizes', () => {
        const bar = document.createElement('nav');
        const main = document.createElement('main');
        const { result } = renderHook(() => useResizeWatchAll([bar, main]));
        const onChange = vi.fn();

        result.current?.(onChange);

        expect(resizeObserver.observed.has(bar)).toBe(true);
        expect(resizeObserver.observed.has(main)).toBe(true);
        expect(resizeObserver.options.get(main)).toEqual({ box: 'border-box' });

        act(() => {
            reportResize([main]);
        });

        // Kills: a watch that stops at the first node, which a sidebar collapse would never reach.
        expect(onChange).toHaveBeenCalledOnce();
    });

    it('watches the nodes it has while another has not mounted yet', () => {
        const main = document.createElement('main');
        const { result } = renderHook(() => useResizeWatchAll([null, main]));

        result.current?.(vi.fn());

        expect(resizeObserver.observed.has(main)).toBe(true);
    });

    it('stops observing every node with its one cleanup', () => {
        const bar = document.createElement('nav');
        const main = document.createElement('main');
        const { result } = renderHook(() => useResizeWatchAll([bar, main]));
        const stop = result.current?.(vi.fn());

        stop?.();

        expect(resizeObserver.observed.size).toBe(0);
    });
});
