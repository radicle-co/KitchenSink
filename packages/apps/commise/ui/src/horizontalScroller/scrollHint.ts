/**
 * @module @commise/ui/horizontal-scroller — the pure policy of the scroll hint
 * (`docs/design/uiOverhaul/horizontalScrollHint.md` §3.3): from the numbers a horizontal scroller reports about itself,
 * whether it overflows, whether it rests at either end, and so whether the chevron and the trailing fade show.
 *
 * One rule for every scroller and both platforms. The web and native hooks only gather the numbers; the browse rail's
 * Previous and Next read the same booleans, so a button and the chevron cannot disagree about where the track is.
 *
 * Pure: every DOM or native read happens at the call site and arrives as a number.
 *
 * @pattern Policy — the hint's rule is a pure function of the scroller's geometry, kept apart from the two adapters
 */

/** Sub-pixel slack, in px: absorbs the fractional `scrollLeft` of a zoomed or scaled display. */
const SLACK_PX = 1;

/** The numbers a scroller reports about itself. */
export interface ScrollGeometry {
    /** The distance from the START edge, in px; negative while the platform overscrolls past it. */
    readonly startOffset: number;
    /** The width of the box that shows the content. */
    readonly viewport: number;
    /** The width of the content. */
    readonly content: number;
}

/** What a scroller knows about where it rests. */
export interface ScrollExtent {
    /** Whether the box and the content have both been laid out. Until then nothing else here is a fact. */
    readonly measured: boolean;
    /** Whether the content is wider than the box. */
    readonly overflows: boolean;
    /** Whether the scroller rests at its start (also true while it does not overflow). */
    readonly atStart: boolean;
    /** Whether the scroller rests at its end (also true while it does not overflow). */
    readonly atEnd: boolean;
}

/** Nothing is known until the scroller is measured: it rests at both ends, so no button and no hint acts. */
export const UNMEASURED_EXTENT: ScrollExtent = { measured: false, overflows: false, atStart: true, atEnd: true };

/**
 * Where a scroller rests. Pure.
 *
 * @param geometry - The scroller's offset and sizes.
 * @returns Whether it is measured, whether it overflows, and whether it is at either end.
 */
export function scrollExtentOf({ startOffset, viewport, content }: ScrollGeometry): ScrollExtent {
    if (viewport <= 0 || content <= 0) {
        return UNMEASURED_EXTENT;
    }

    return {
        measured: true,
        overflows: content - viewport > SLACK_PX,
        atStart: startOffset <= SLACK_PX,
        atEnd: content - viewport - startOffset <= SLACK_PX,
    };
}

/** Which parts of the hint show. */
export interface ScrollHint {
    /** The chevron at the inline-end edge: the scroller overflows and has not been scrolled. */
    readonly chevron: boolean;
    /** The fade over the inline-end edge: more content lies ahead. */
    readonly fade: boolean;
}

/**
 * The hint for a scroller's extent. Before the first measure neither shows. Pure.
 *
 * @param extent - Where the scroller rests.
 * @returns Whether the chevron and the fade show.
 */
export function scrollHintOf({ measured, overflows, atStart, atEnd }: ScrollExtent): ScrollHint {
    return { chevron: measured && overflows && atStart, fade: measured && !atEnd };
}

/** Where a scroller runs: a browser, or one of the two native platforms. */
export type ScrollPlatform = 'web' | 'ios' | 'android';

/**
 * The distance from the START edge, from the offset the platform reports. A negative result is overscroll (the iOS
 * bounce) and reads as 0. Pure.
 *
 * - Web: `scrollLeft` counts from 0 at the start in a left-to-right page and negative from 0 in a right-to-left one.
 * - iOS and Android, left-to-right: `contentOffset.x`.
 * - ⚠️ Native right-to-left is the platform's own convention and has NOT been checked on a device: iOS is read as already
 *   start-relative, Android as counted from the physical left, so the start is `content - viewport - x`.
 *
 * @param x - The reported offset.
 * @param viewport - The width of the box.
 * @param content - The width of the content.
 * @param rtl - Whether the layout direction is right-to-left.
 * @param platform - Which platform reported it.
 * @returns The distance from the start edge in px, never negative.
 */
export function startOffsetOf(
    x: number,
    viewport: number,
    content: number,
    rtl: boolean,
    platform: ScrollPlatform,
): number {
    if (!rtl) {
        return Math.max(0, x);
    }

    if (platform === 'web') {
        return Math.max(0, -x);
    }

    return Math.max(0, platform === 'android' ? content - viewport - x : x);
}

/**
 * How far one arrow-key press moves a scroller: the distance from one item to the next (which includes the gap), the
 * first item alone while there is no second, or most of a view while no item has been laid out. Pure.
 *
 * @param firstWidth - The first item's width in px, or 0 when it has not been laid out.
 * @param pitch - The distance between the start of the first item and the start of the second, or 0 when there is none.
 * @param viewport - The width of the box.
 * @returns The distance in px, always positive.
 */
export function itemStepOf(firstWidth: number, pitch: number, viewport: number): number {
    if (pitch > 0) {
        return pitch;
    }

    return firstWidth > 0 ? firstWidth : Math.max(viewport * 0.8, 1);
}
