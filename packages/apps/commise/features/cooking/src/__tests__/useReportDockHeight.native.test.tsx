/**
 * The dock's reported height: the foot's height while a dock draws, and 0 when it goes, so the one snackbar host
 * draws above the dock and drops back when it leaves.
 * Mutation lens: a report that never clears on unmount, one that fires while no dock draws, or one that reads the
 * wrong layout field each fail a row here.
 */
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { DockHeightContext } from '../dockHeightContext.js';
import { useReportDockHeight } from '../useReportDockHeight.native.js';

const layout = (height: number) => ({ nativeEvent: { layout: { height } } });

function setup(initial: boolean) {
    const report = vi.fn();
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
        <DockHeightContext value={report}>{children}</DockHeightContext>
    );
    const hook = renderHook(({ present }) => useReportDockHeight(present), {
        wrapper,
        initialProps: { present: initial },
    });

    return { report, hook };
}

describe('useReportDockHeight', () => {
    it('reports the foot height from its layout while a dock draws', () => {
        const { report, hook } = setup(true);

        act(() => {
            hook.result.current(layout(142));
        });

        expect(report).toHaveBeenCalledWith(142);
    });

    it('reports nothing while no dock draws', () => {
        const { report, hook } = setup(false);

        act(() => {
            hook.result.current(layout(96));
        });

        expect(report).not.toHaveBeenCalledWith(96);
    });

    it('reports 0 when the dock goes and when the screen unmounts', () => {
        const { report, hook } = setup(true);

        hook.rerender({ present: false });

        expect(report).toHaveBeenLastCalledWith(0);

        hook.rerender({ present: true });
        report.mockClear();
        hook.unmount();

        expect(report).toHaveBeenCalledWith(0);
    });
});
