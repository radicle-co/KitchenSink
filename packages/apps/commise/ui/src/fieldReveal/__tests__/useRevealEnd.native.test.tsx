/**
 * A row hands the fields inside it a revealer that names the row as the `end` of their `focus` requests (so the host can
 * keep the row's last control, an open editor's Done and Cancel, above the keyboard with the field). The row's node is read
 * only when the host measures the end, never in render, and a node that is gone cannot be measured, which the host reads as
 * "no end".
 */
import { renderHook } from '@testing-library/react';
import type { FC, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
    FieldRevealContext,
    type FieldRevealer,
    type RevealRequest,
    type RevealTarget,
} from '../fieldRevealContext.js';
import { useRevealEnd } from '../useRevealEnd.native.js';

const field: RevealTarget = { measureLayout: () => undefined };

/** The end a focus request carries. */
const endOf = (request: RevealRequest | undefined): RevealTarget | undefined =>
    request?.kind === 'focus' ? request.end : undefined;

/** A host whose revealer is a spy, and the requests it was asked. */
function hosted() {
    const asked: RevealRequest[] = [];
    const parent = vi.fn<FieldRevealer>((request) => {
        asked.push(request);

        return () => undefined;
    });
    const wrapper: FC<{ readonly children: ReactNode }> = ({ children }) => (
        <FieldRevealContext.Provider value={parent}>{children}</FieldRevealContext.Provider>
    );

    return { asked, parent, wrapper };
}

describe('useRevealEnd', () => {
    it('hands the parent a focus request whose end is the row, measured through the row’s own node', () => {
        const { asked, wrapper } = hosted();
        const measureLayout = vi.fn();
        const { result } = renderHook(() => useRevealEnd({ current: { measureLayout } }), { wrapper });

        result.current({ kind: 'focus', field });

        const request = asked[0];
        const onSuccess = vi.fn();
        const onFail = vi.fn();

        expect(request).toMatchObject({ kind: 'focus', field });
        expect(endOf(request)).toBeDefined();

        const relativeTo = 7;

        endOf(request)?.measureLayout(relativeTo, onSuccess, onFail);

        expect(measureLayout).toHaveBeenCalledExactlyOnceWith(relativeTo, onSuccess, onFail);
    });

    it('fails the measurement of an end whose node has gone, so the host shows the field alone', () => {
        const { asked, wrapper } = hosted();
        const { result } = renderHook(() => useRevealEnd({ current: null }), { wrapper });
        const onFail = vi.fn();

        result.current({ kind: 'focus', field });
        const request = asked[0];

        endOf(request)?.measureLayout(7, vi.fn(), onFail);

        expect(onFail).toHaveBeenCalledOnce();
    });

    it('hands every other request to the parent untouched', () => {
        const { parent, wrapper } = hosted();
        const { result } = renderHook(() => useRevealEnd({ current: null }), { wrapper });
        const request: RevealRequest = { kind: 'arrival', field, above: 40 };

        result.current(request);

        expect(parent).toHaveBeenCalledExactlyOnceWith(request);
    });

    it('keeps the same revealer across re-renders, so no field re-asks', () => {
        const { wrapper } = hosted();
        const node = { current: null };
        const { result, rerender } = renderHook(() => useRevealEnd(node), { wrapper });
        const first = result.current;

        rerender();

        expect(result.current).toBe(first);
    });
});
