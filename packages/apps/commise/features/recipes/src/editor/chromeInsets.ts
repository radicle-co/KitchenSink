/**
 * @module @commise/features-recipes/editor — how much of the viewport the web editor's own chrome covers, for the
 * popups in its sections to keep clear of (`docs/design/rowEditorOpenDecisions.md` V3-1).
 */
import type { PopupInsets } from '@commise/ui/popup-insets';

/** The chrome's edges in the viewport, as the browser lays them out now. */
export interface ChromeEdges {
    /** The header band's bottom edge, or `undefined` before the band mounts. */
    readonly bandBottom: number | undefined;
    /** The action bar's top edge while it holds the viewport's foot, or `undefined` while it does not. */
    readonly barTop: number | undefined;
    readonly viewportHeight: number;
}

/**
 * The CSS px the chrome covers: above, the band's bottom edge, or 0 for a band out of view; below, the viewport's height
 * less the bar's top edge, or 0 for a bar that is not fixed or sits below the viewport. Pure.
 *
 * @param edges - The chrome's edges.
 * @returns The insets a popup keeps clear of.
 */
export function chromeInsetsOf({ bandBottom, barTop, viewportHeight }: ChromeEdges): PopupInsets {
    return {
        top: bandBottom === undefined ? 0 : Math.max(0, bandBottom),
        bottom: barTop === undefined ? 0 : Math.max(0, viewportHeight - barTop),
    };
}

/**
 * Read the top chrome's and the action bar's edges from the page as it is laid out now, by their element ids. The top
 * chrome is the header and, below 960 px, the section index's bar or strip stuck under it: its edge is the LOWEST
 * bottom of those boxes, and a box the width hides measures 0, so it takes no part. The bar is `sticky` at the form
 * column's foot: while it holds the viewport's foot its top edge is inside the viewport.
 *
 * @param topIds - The element ids of the sticky boxes at the top, the header first.
 * @param barId - The action bar's element id.
 * @returns The insets a popup keeps clear of.
 * @sideEffect Reads layout: one bounding rect per box.
 */
export function readChromeInsets(topIds: readonly string[], barId: string): PopupInsets {
    const viewportHeight = document.documentElement.clientHeight;
    const barTop = document.getElementById(barId)?.getBoundingClientRect().top;
    const bottoms = topIds.flatMap((id) => {
        const node = document.getElementById(id);

        return node === null ? [] : [node.getBoundingClientRect().bottom];
    });

    return chromeInsetsOf({
        bandBottom: bottoms.length === 0 ? undefined : Math.max(...bottoms),
        barTop: barTop !== undefined && barTop < viewportHeight ? barTop : undefined,
        viewportHeight,
    });
}
