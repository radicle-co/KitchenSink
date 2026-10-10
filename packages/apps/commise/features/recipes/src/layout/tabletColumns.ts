/**
 * How many columns a recipe grid lays out at a given viewport width, and the reading measure a body column
 * is capped to.
 *
 * ## Why this exists
 *
 * `mobile/app.json` declares `supportsTablet: true`, and nothing in the recipe screens adapted to width —
 * the only `useWindowDimensions` in the feature was the photo carousel's. So at 768–1024pt the list
 * rendered a single column of full-width cards, the discovery grid stayed pinned at two (~500pt cards), and
 * detail body text ran the full width of an iPad, far past the 45–75 character measure a reader can track.
 * That is a phone layout stretched, not a tablet layout.
 *
 * ⛔ A BREAKPOINT, NOT A FORMULA. `floor(width / targetCardWidth)` reads as more principled and is harder to
 * get right: the target that gives the list two columns on an iPad gives the discovery grid four, and the
 * target that keeps discovery at two on a phone collapses the list to one everywhere. The two grids want
 * different counts at the same width because their cards carry different content, so each names its own
 * pair and shares only the question "is this a tablet".
 *
 * ⚠️ 768 is the `md` token the web side already breaks at, chosen so the two platforms change shape at the
 * same width rather than at two numbers that merely look similar. It is a WIDTH, so an iPad in portrait
 * (768) and a phone in landscape are both "tablet" here — which is the correct reading, since the question
 * is how much horizontal room a card has.
 */

/** The width at or above which a viewport gets the tablet layout. Matches the web `md` breakpoint. */
export const TABLET_MIN_WIDTH = 768;

/**
 * The widest a single column of body text may run, in dp.
 *
 * ⚠️ NOT a device width. It is the measure — roughly 45–75 characters at this app's body size — past which a
 * reader loses the line they are on returning to the left margin. On a phone the viewport is already
 * narrower than this, so the cap does nothing; on an iPad it is the whole point.
 */
export const READING_MEASURE_WIDTH = 640;

/**
 * Whether a viewport of this width gets the tablet layout.
 *
 * @param width - The viewport width in dp, from `useWindowDimensions`.
 * @returns Whether the tablet layout applies. Pure.
 */
export function isTabletWidth(width: number): boolean {
    return width >= TABLET_MIN_WIDTH;
}

/**
 * The column count for a grid that shows `phone` columns on a phone and `tablet` on a tablet.
 *
 * @param width - The viewport width in dp.
 * @param counts - The column count for each band.
 * @returns The column count for this width. Pure.
 */
export function recipeGridColumns(width: number, counts: { readonly phone: number; readonly tablet: number }): number {
    return isTabletWidth(width) ? counts.tablet : counts.phone;
}
