/**
 * @module @commise/ui/pushed-page — the pinned bar's display facts, derived once. Pure; both `PushedPageFrame` leaves
 * read it, so the web and native bars cannot disagree about when the material and the title show.
 */

/** What the frame reads from its `ScrollHost`. */
export interface BarSource {
    /** The scroller is at its top. */
    readonly atTop: boolean;
    /** The H1 has scrolled under the bar. */
    readonly condensed: boolean;
}

/** What the pinned `CondensedTitleBar` draws around its always-present controls. */
export interface BarFacts {
    /** The material shows: the page has scrolled, so there is content behind the bar. */
    readonly surfaceShown: boolean;
    /** The one-line title shows: the large title is under the bar. */
    readonly titleShown: boolean;
}

/**
 * The bar's two display facts from the host's scroll state.
 *
 * @param source - Whether the scroller is at its top, and whether the H1 is under the bar.
 * @returns The material shows once the page has scrolled; the title once the H1 is under the bar. Pure.
 */
export function barFactsOf({ atTop, condensed }: BarSource): BarFacts {
    return { surfaceShown: !atTop, titleShown: condensed };
}
