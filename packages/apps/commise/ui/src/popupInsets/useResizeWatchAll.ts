/**
 * @module @commise/ui/popup-insets — several nodes' size changes, as ONE `watch` the snackbar host can start and stop
 * (web). For a page whose entry depends on more than one box: the shell's tab bar and its `<main>` column.
 *
 * @pattern Observer — one `ResizeObserver` over the nodes, started and stopped by whoever subscribes
 */
import { useMemo } from 'react';

import type { PopupInsetsWatch } from './popupInsetsRegistry.js';

/**
 * The `watch` for several nodes, each observed by its border box as `useResizeWatch` does.
 *
 * @sideEffect Calling the returned watch creates a `ResizeObserver` on every node that exists, and its cleanup
 *     disconnects them all.
 * @param nodes - The elements, each held as state by a callback ref and `null` before it mounts. Stable while the
 *     elements are the same: a new array re-registers the entry.
 * @returns A watch stable while the nodes are the same, or `undefined` with no node or no `ResizeObserver` (a server
 *     render).
 */
export function useResizeWatchAll(nodes: readonly (HTMLElement | null)[]): PopupInsetsWatch | undefined {
    return useMemo(() => {
        const present = nodes.filter((node): node is HTMLElement => node !== null);

        if (present.length === 0 || typeof ResizeObserver !== 'function') {
            return undefined;
        }

        return (onChange) => {
            const observer = new ResizeObserver(() => {
                onChange();
            });

            for (const node of present) {
                observer.observe(node, { box: 'border-box' });
            }

            return () => {
                observer.disconnect();
            };
        };
    }, [nodes]);
}
