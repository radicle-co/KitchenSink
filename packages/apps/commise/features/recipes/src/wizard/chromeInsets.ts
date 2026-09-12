/**
 * @module @commise/features-recipes/wizard — how much of the viewport the web wizard's own chrome covers, for the
 * popups in its step bodies to keep clear of (`docs/design/rowEditorOpenDecisions.md` V3-1).
 */
import type { PopupInsets } from '@commise/ui/popup-insets';

/** The chrome's edges in the viewport, as the browser lays them out now. */
export interface ChromeEdges {
    /** The header band's bottom edge, or `undefined` before the band mounts. */
    readonly bandBottom: number | undefined;
    /** The controls bar's top edge while it is fixed to the viewport's foot, or `undefined` while it is not. */
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
 * Read the band's and the bar's edges from the page as it is laid out now.
 *
 * @param band - The header band's node, once mounted.
 * @param bar - The controls bar's node, once mounted.
 * @returns The insets a popup keeps clear of.
 * @sideEffect Reads layout: two bounding rects and the bar's computed `position`.
 */
export function readChromeInsets(band: HTMLElement | null, bar: HTMLElement | null): PopupInsets {
    return chromeInsetsOf({
        bandBottom: band?.getBoundingClientRect().bottom,
        barTop:
            bar !== null && getComputedStyle(bar).position === 'fixed' ? bar.getBoundingClientRect().top : undefined,
        viewportHeight: document.documentElement.clientHeight,
    });
}
