/**
 * @module @commise/ui/horizontal-scroller — the shared contract of the design-system `HorizontalScroller`
 * (`docs/design/uiOverhaul/horizontalScrollHint.md` §2). Both platform leaves implement exactly these props
 * (`docs/CODING_STANDARDS.md` §14.4): a screen states what it wants, never which platform it runs on.
 */
import type { ReactNode } from 'react';

import type { ScrollExtent } from './scrollHint.js';

/**
 * The surface behind the scroller: the page (`canvas`, the default), a sheet (`overlay`) or a bar (`bar`). The native
 * fade ends in the colour behind it, so it must know which, or the fade shows as a stripe. The web fade is a mask and
 * ignores this.
 */
export type ScrollerSurface = 'canvas' | 'overlay' | 'bar';

/**
 * How the scroller settles.
 *
 * - `none`: wherever the reader leaves it.
 * - `item`: to the start of the nearest item when it comes to rest near one (a row of chips). Native has no proximity
 *   snap, so it stays free.
 * - `card`: to the start of an item, always; `interval` is the distance from one card's start to the next, in px,
 *   which native snaps by and web (which snaps to the cards themselves) ignores.
 */
export type ScrollerSnap =
    { readonly kind: 'none' } | { readonly kind: 'item' } | { readonly kind: 'card'; readonly interval: number };

/** The cross-platform `HorizontalScroller` contract. */
export interface HorizontalScrollerProps {
    /** The content row. The scroller wraps it in a box as wide as it is. */
    readonly children: ReactNode;
    /** The surface behind the scroller; see {@link ScrollerSurface}. */
    readonly surface?: ScrollerSurface;
    /** How the scroller settles; see {@link ScrollerSnap}. Defaults to `none`. */
    readonly snap?: ScrollerSnap;
    /**
     * Makes the scroller a named region the reader can focus. On web it is a tab stop and the arrow keys move it by one
     * item (a list item, `li`); native scrolls by touch only.
     */
    readonly regionLabel?: string;
    /** Web only: receives the scroll element, and `null` when it goes. Inert on native. */
    readonly onScroller?: (element: HTMLElement | null) => void;
    /** Receives where the scroller rests, once measured and again each time it reaches or leaves an end. */
    readonly onPosition?: (extent: ScrollExtent) => void;
}
