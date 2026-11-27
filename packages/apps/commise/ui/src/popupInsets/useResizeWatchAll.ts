/**
 * @module @commise/ui/popup-insets — several nodes' size changes, as ONE `watch` the snackbar host can start and stop
 * (web). For a page whose entry depends on more than one box: the shell's tab bar and its `<main>` column.
 *
 * @pattern Observer — one `ResizeObserver` over the nodes, started and stopped by whoever subscribes
 */
import { useMemo } from 'react';

import type { PopupInsetsWatch } from './popupInsetsRegistry.js';
import { resizeWatchOf } from './useResizeWatch.js';

/**
 * The `watch` for several nodes, each observed by its border box as `useResizeWatch` does.
 *
 * @param nodes - The elements, each `null` before it mounts. Stable while the elements are the same: a new array
 *     re-registers the entry.
 * @returns A watch stable while the nodes are the same, or `undefined` with no node or no `ResizeObserver`.
 */
export function useResizeWatchAll(nodes: readonly (HTMLElement | null)[]): PopupInsetsWatch | undefined {
    return useMemo(() => resizeWatchOf(nodes.filter((node): node is HTMLElement => node !== null)), [nodes]);
}
