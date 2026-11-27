/**
 * @module @commise/ui/resize-watch — a node's size changes, as a `watch` the snackbar host can start and stop (web).
 *
 * The page chrome the snackbar sits above (the tab bar, the editor's action bar) can change size while a snackbar
 * shows: the system text size changes, or a rotation changes the bar's safe-area padding. The reader measures the
 * border box with `getBoundingClientRect`, so this observes the border box too: the default content box stays silent
 * when only the padding changes.
 *
 * @pattern Observer — a `ResizeObserver` over the node, started and stopped by whoever subscribes
 */
import { useMemo } from 'react';

import type { PopupInsetsWatch } from '../popupInsets/popupInsetsRegistry.js';

/**
 * The `watch` for one node.
 *
 * @sideEffect Calling the returned watch creates a `ResizeObserver` on the node, and its cleanup disconnects it.
 * @param node - The chrome's element, held as state by a callback ref; `null` before it mounts.
 * @returns A stable watch while the node is the same, or `undefined` with no node or no `ResizeObserver` (a server
 *     render).
 */
export function useResizeWatch(node: HTMLElement | null): PopupInsetsWatch | undefined {
    return useMemo(() => {
        if (node === null || typeof ResizeObserver !== 'function') {
            return undefined;
        }

        return (onChange) => {
            const observer = new ResizeObserver(() => {
                onChange();
            });

            observer.observe(node, { box: 'border-box' });

            return () => {
                observer.disconnect();
            };
        };
    }, [node]);
}
