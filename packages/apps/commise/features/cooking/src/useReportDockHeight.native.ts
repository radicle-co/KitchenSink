/**
 * @module useReportDockHeight — reports the height of the cooking foot, and 0 when the screen goes.
 *
 * @pattern Observer — see `dockHeightContext`
 */
import { useCallback, useContext, useEffect } from 'react';

import { DockHeightContext } from './dockHeightContext.js';

/** The part of a layout event the report reads. */
interface FootLayout {
    readonly nativeEvent: { readonly layout: { readonly height: number } };
}

/**
 * The foot's `onLayout` handler for a screen whose foot draws throughout, so the snackbar host stays above Back and Next
 * after the last timer goes.
 *
 * @returns The handler: it reports the foot's height on each layout. The report is 0 once the screen unmounts.
 * @sideEffect Calls the reporter the route adapter provided.
 */
export function useReportDockHeight(): (event: FootLayout) => void {
    const report = useContext(DockHeightContext);

    useEffect(
        () => () => {
            report(0);
        },
        [report],
    );

    return useCallback(
        (event) => {
            report(event.nativeEvent.layout.height);
        },
        [report],
    );
}
