/**
 * The pinned search's state hook (native, react-native-web under jsdom): the node set is built over the host's scroll offset and
 * is NOT swapped by a re-measure or a re-render (qa-ios ScaleToCap: swapping a node on a native-driven view left the view showing
 * the old node's value). Only a different host offset builds a new set.
 */
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { Animated } from 'react-native';
import { describe, expect, it } from 'vitest';

import { ScrollHostContext } from '../../scrollHost/scrollHostContext.js';
import type { ScrollHostApi } from '../../scrollHost/props.js';
import { usePinnedSearch } from '../usePinnedSearch.native.js';

/** A host that holds the given offset; the hook reads only `scrollY` and `viewportsDown`. */
function hostOver(scrollY: Animated.Value) {
    const api = { scrollY, viewportsDown: 0 } as unknown as ScrollHostApi;

    return ({ children }: { readonly children: ReactNode }) => (
        <ScrollHostContext value={api}>{children}</ScrollHostContext>
    );
}

describe('usePinnedSearch node set', () => {
    it('keeps the SAME nodes across re-renders over the same scroll offset', () => {
        const wrapper = hostOver(new Animated.Value(0));
        const { result, rerender } = renderHook(({ query }) => usePinnedSearch(query, 0), {
            wrapper,
            initialProps: { query: '' },
        });
        const first = result.current.searchPin;

        rerender({ query: 'pasta' });

        expect(result.current.searchPin).toBe(first);
    });

    it('keeps the SAME nodes when the spacer is measured or the field grows', () => {
        const wrapper = hostOver(new Animated.Value(0));
        const { result } = renderHook(() => usePinnedSearch('', 0), { wrapper });
        const first = result.current.searchPin;

        act(() => {
            result.current.onSpacerLayout({ x: 0, y: 180, width: 320 });
            result.current.onFieldHeight(48);
        });

        expect(result.current.spacer).toEqual({ x: 0, y: 180, width: 320 });
        expect(result.current.searchPin).toBe(first);
    });

    it('builds a new set only when the host hands a different scroll offset', () => {
        const a = new Animated.Value(0);
        const b = new Animated.Value(0);
        let current = a;
        const wrapper = ({ children }: { readonly children: ReactNode }) => hostOver(current)({ children });
        const { result, rerender } = renderHook(() => usePinnedSearch('', 0), { wrapper });
        const first = result.current.searchPin;

        current = b;
        rerender();

        expect(result.current.searchPin).not.toBe(first);
    });
});
