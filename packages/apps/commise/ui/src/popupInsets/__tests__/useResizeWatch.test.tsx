// @vitest-environment jsdom
/**
 * The web `useResizeWatch`: a stable `watch` for one node that tells its caller when the node's size may have changed.
 * It observes the node's BORDER box, because the readers it serves measure `getBoundingClientRect` (the border box), so
 * a change of padding alone, such as the tab bar's safe-area inset on a rotation, must report. Its cleanup stops the
 * observation. Written before the hook.
 */
import { resizeObserver, reportResize } from '../../testing/resizeObserver.js';

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useResizeWatch } from '../useResizeWatch.js';

afterEach(() => {
    cleanup();
    resizeObserver.observed.clear();
    resizeObserver.options.clear();
});

describe('useResizeWatch', () => {
    it('has no watch before there is a node', () => {
        const { result } = renderHook(() => useResizeWatch(null));

        expect(result.current).toBeUndefined();
    });

    it('observes the node by its border box, and tells the caller when it resizes', () => {
        const node = document.createElement('div');
        const { result } = renderHook(() => useResizeWatch(node));
        const onChange = vi.fn();

        result.current?.(onChange);

        expect(resizeObserver.observed.has(node)).toBe(true);
        // Kills: the default content box, which stays silent when only the padding changes.
        expect(resizeObserver.options.get(node)).toEqual({ box: 'border-box' });

        act(() => {
            reportResize([node]);
        });

        expect(onChange).toHaveBeenCalledOnce();
    });

    it('stops observing, and stops telling the caller, once its cleanup has run', () => {
        const node = document.createElement('div');
        const { result } = renderHook(() => useResizeWatch(node));
        const onChange = vi.fn();
        const stop = result.current?.(onChange);

        stop?.();

        // Kills: a cleanup that leaves the observer connected, which leaks one per registration.
        expect(resizeObserver.observed.size).toBe(0);
    });

    it('is the same watch while the node is the same, and a new one for another node', () => {
        const first = document.createElement('div');
        const second = document.createElement('div');
        const { result, rerender } = renderHook(({ node }) => useResizeWatch(node), { initialProps: { node: first } });
        const watch = result.current;

        rerender({ node: first });

        // Kills: a watch rebuilt on every render, which re-registers the entry each time.
        expect(result.current).toBe(watch);

        rerender({ node: second });

        expect(result.current).not.toBe(watch);
    });
});
