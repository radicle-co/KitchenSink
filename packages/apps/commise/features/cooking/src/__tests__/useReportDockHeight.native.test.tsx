/**
 * The foot's reported height: the foot's layout height whenever the foot draws, and 0 when the screen unmounts, so the
 * one snackbar host draws above the foot and drops back when it leaves.
 * Mutation lens: a report that never clears on unmount, one that clears too early, or one that reads the wrong layout
 * field each fail a row here.
 */
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { DockHeightContext } from '../dockHeightContext.js';
import { useReportDockHeight } from '../useReportDockHeight.native.js';

const layout = (height: number) => ({ nativeEvent: { layout: { height } } });

function setup() {
    const report = vi.fn();
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
        <DockHeightContext value={report}>{children}</DockHeightContext>
    );

    return { report, hook: renderHook(() => useReportDockHeight(), { wrapper }) };
}

describe('useReportDockHeight', () => {
    it('reports the foot height from each layout, and nothing before one', () => {
        const { report, hook } = setup();

        expect(report).not.toHaveBeenCalled();

        act(() => {
            hook.result.current(layout(142));
        });
        act(() => {
            hook.result.current(layout(96));
        });

        expect(report.mock.calls).toEqual([[142], [96]]);
    });

    it('reports 0 when the screen unmounts, and not before', () => {
        const { report, hook } = setup();

        act(() => {
            hook.result.current(layout(142));
        });
        report.mockClear();
        hook.rerender();

        expect(report).not.toHaveBeenCalled();

        hook.unmount();

        expect(report).toHaveBeenCalledWith(0);
    });
});
