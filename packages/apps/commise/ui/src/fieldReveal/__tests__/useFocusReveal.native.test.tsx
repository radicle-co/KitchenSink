/**
 * A field holds its place while the cook types in it (`docs/design/uiOverhaul/specSharedSystem.md` §16.3): it sends the
 * reveal host a `focus` request when it gains focus and releases it when it blurs or unmounts.
 */
import { renderHook } from '@testing-library/react';
import type { FC, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { FieldRevealContext, type FieldRevealer, type RevealTarget } from '../fieldRevealContext.js';
import { useFocusReveal } from '../useFocusReveal.native.js';

/** A host whose revealer is a spy, and the release it hands back. */
function hosted() {
    const release = vi.fn();
    const revealer = vi.fn<FieldRevealer>(() => release);
    const wrapper: FC<{ readonly children: ReactNode }> = ({ children }) => (
        <FieldRevealContext.Provider value={revealer}>{children}</FieldRevealContext.Provider>
    );

    return { release, revealer, wrapper };
}

const node: RevealTarget = { measureLayout: () => undefined };

describe('useFocusReveal', () => {
    it('sends nothing while the field is not focused', () => {
        const { revealer, wrapper } = hosted();

        renderHook(() => useFocusReveal({ current: node }, false), { wrapper });

        expect(revealer).not.toHaveBeenCalled();
    });

    it('sends a focus request carrying the field’s node when it gains focus', () => {
        const { revealer, wrapper } = hosted();
        const { rerender } = renderHook(({ focused }) => useFocusReveal({ current: node }, focused), {
            wrapper,
            initialProps: { focused: false },
        });

        rerender({ focused: true });

        expect(revealer).toHaveBeenCalledExactlyOnceWith({ kind: 'focus', field: node });
    });

    it('asks once for a whole focus, however often the field re-renders', () => {
        const { revealer, wrapper } = hosted();
        const { rerender } = renderHook(() => useFocusReveal({ current: node }, true), { wrapper });

        rerender();
        rerender();

        expect(revealer).toHaveBeenCalledTimes(1);
    });

    it('releases when the field blurs, and asks again on the next focus', () => {
        const { release, revealer, wrapper } = hosted();
        const { rerender } = renderHook(({ focused }) => useFocusReveal({ current: node }, focused), {
            wrapper,
            initialProps: { focused: true },
        });

        rerender({ focused: false });
        expect(release).toHaveBeenCalledTimes(1);

        rerender({ focused: true });
        expect(revealer).toHaveBeenCalledTimes(2);
    });

    it('releases when the field unmounts while focused', () => {
        const { release, wrapper } = hosted();
        const { unmount } = renderHook(() => useFocusReveal({ current: node }, true), { wrapper });

        unmount();

        expect(release).toHaveBeenCalledTimes(1);
    });

    it('asks nothing of a field with no node to measure', () => {
        const { revealer, wrapper } = hosted();

        renderHook(() => useFocusReveal({ current: null }, true), { wrapper });

        expect(revealer).not.toHaveBeenCalled();
    });

    it('asks nothing, and does not throw, where no host provides a revealer', () => {
        expect(() => renderHook(() => useFocusReveal({ current: node }, true))).not.toThrow();
    });
});
