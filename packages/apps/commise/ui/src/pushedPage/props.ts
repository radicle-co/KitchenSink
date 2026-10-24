/**
 * @module @commise/ui/pushed-page — the shared contract of the design-system `PushedPageFrame`
 * (`docs/design/uiRefreshWorkshop5/pinnedBackBar.md` §7): the one frame every pushed page mounts, so a pushed page has
 * a pinned Back in every state and at every scroll position. It owns the page's ONE `ScrollHost`, lays the pinned
 * `CondensedTitleBar` over the scroller, and hands the page its `bind`.
 */
import type { ReactNode } from 'react';

import type { HeaderBack } from '../largeTitleHeader/props.js';
import type { ScrollBind } from '../scrollHost/props.js';

/**
 * The room the frame leaves at the top of the page's content for the pinned bar. The frame OWNS it, so no page restates
 * the bar's height: native pads by `PINNED_BAR_HEIGHT`; on web `<main>` owns the room (the shell draws a notice above the
 * page, which must sit under the bar too), so it is 0 there.
 */
export interface PushedPageInset {
    readonly paddingTop: number;
}

/** The cross-platform `PushedPageFrame` contract. */
export interface PushedPageFrameProps {
    /** The way back, pinned in the bar. Its `label` is the one accessible "Back to {parent}" on the page. */
    readonly back: HeaderBack;
    /** The page's H1 id: web watches it to decide when the bar's title shows. Native finds the heading by its layout. */
    readonly headingId: string;
    /** The bar's one-line title; absent while the page does not know it (loading). */
    readonly title?: string;
    /** The page's ⋯ menu, drawn in the bar. */
    readonly menu?: ReactNode;
    /**
     * The page. On native, the screen's ONE vertical scroller spreads `bind` and merges `inset` into its content style, so
     * its content starts under the bar; a loading or error state that does not scroll merges the same `inset` into its
     * wrapper. On web the document scrolls, `bind` is unused and `inset` is empty.
     */
    readonly children: (bind: ScrollBind, inset: PushedPageInset) => ReactNode;
}
