/**
 * @module useReportDockHeight — reports the height of the foot that carries the timer dock, and 0 when the dock goes.
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
 * The foot's `onLayout` handler for a screen with a dock.
 *
 * @param present - Whether a dock draws in the foot now.
 * @returns The handler: while `present`, it reports the foot's height. The report is 0 once the dock goes or the screen
 *   unmounts.
 * @sideEffect Calls the reporter the route adapter provided.
 */
export function useReportDockHeight(present: boolean): (event: FootLayout) => void {
    const report = useContext(DockHeightContext);

    useEffect(() => {
        if (!present) {
            return undefined;
        }

        return () => {
            report(0);
        };
    }, [present, report]);

    return useCallback(
        (event) => {
            if (present) {
                report(event.nativeEvent.layout.height);
            }
        },
        [present, report],
    );
}
