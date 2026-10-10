/**
 * @module @commise/ui/layout — when a pinned footer stops being pinned (`docs/design/compactHeightLayout.md` §3.1;
 * `docs/design/ingredientSpecialization.md` §S8.1, finding I7; owner ruling: option B, "unpin past a limit"). The web
 * hook that reads it is `@commise/ui/pinned-footer` (`./usePinnedFooter.ts`); `@commise/ui/layout` exports the native
 * one.
 *
 * A frame pins a top row (the one that holds the exit: the Sheet's title row with Close, the recipe wizard's header
 * with Back) and a footer (the actions) around a scroll region. At large text, or on a short screen with a keyboard
 * up, the two can take almost the whole frame and leave the content a sliver. Past the limit the footer scrolls with
 * the content instead; the exit stays pinned.
 *
 * The rule reads the frame's ACTUAL height, and that height does not change when the footer moves: pinned, a
 * content-sized frame is `min(top + content + footer, available)`, and unpinned it is the same sum under the same cap.
 * So the decision cannot flip back on the render after the footer moves. A frame that unpins while nothing scrolls
 * looks the same.
 *
 * @pattern Specification — one pure predicate every platform leaf feeds with its own measurements.
 */

/** Heights the rule reads, in px (web) or dp (native). `0` means not measured yet. */
export interface PinnedFooterMeasure {
    /** The pinned row above the scroll region that holds the exit. ⛔ Not the Sheet's toolbar. */
    readonly pinnedTop: number;
    /** The footer, with its padding and hairline. */
    readonly footer: number;
    /** The whole frame. */
    readonly frame: number;
}

/**
 * Whether the footer scrolls with the content instead of staying pinned. Pure.
 *
 * @param measure - The measured heights.
 * @returns `true` when the pinned top row and the footer together are TALLER than half the frame; `false` while the
 *   frame or the footer is unmeasured.
 */
export function isFooterUnpinned(measure: PinnedFooterMeasure): boolean {
    if (measure.frame <= 0 || measure.footer <= 0) {
        return false;
    }

    return measure.pinnedTop + measure.footer > measure.frame / 2;
}

/** The heights a leaf lays out, in px (web) or dp (native), before {@link pinnedFooterMeasureOf} reads them. */
export interface PinnedFooterHeights {
    readonly topHeight: number;
    readonly footerHeight: number;
    /** Whether the footer is laid out in the pinned top row's own flow, so the top row's height includes it. */
    readonly footerInTop: boolean;
    readonly frameHeight: number;
}

/**
 * The measure {@link isFooterUnpinned} reads. A footer in the top row's own flow (the web wizard's bar in its header
 * band at `lg`, `docs/design/compactHeightLayout.md` A1) is taken back off the top row, so the chrome measures the same
 * wherever the footer is, and the answer cannot flip back once it has moved the footer (§3.1). Pure.
 *
 * @param heights - The laid-out heights.
 * @returns The measure.
 */
export function pinnedFooterMeasureOf({
    topHeight,
    footerHeight,
    footerInTop,
    frameHeight,
}: PinnedFooterHeights): PinnedFooterMeasure {
    return { pinnedTop: footerInTop ? topHeight - footerHeight : topHeight, footer: footerHeight, frame: frameHeight };
}
