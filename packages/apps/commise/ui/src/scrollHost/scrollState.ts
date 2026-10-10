/**
 * @module @commise/ui/scroll-host — the scroll state both `ScrollHost` leaves derive from a position, once. Pure.
 */
import { currentSectionOf, type SectionTop } from './currentSection.js';
import { DEPTH_STEP_VIEWPORTS, DIRECTION_DEAD_ZONE_PX, type ScrollSample, type ScrollState } from './props.js';

/** A length in viewports, rounded down to the depth step; 0 for an unmeasured viewport. Pure. */
function viewportsOf(px: number, viewportHeight: number): number {
    if (viewportHeight <= 0) {
        return 0;
    }

    return Math.floor(px / viewportHeight / DEPTH_STEP_VIEWPORTS) * DEPTH_STEP_VIEWPORTS;
}

/**
 * The next scroll state. Inside the dead zone the direction holds its last value.
 *
 * @param previous - The state before this sample.
 * @param sample - The position, the previous one, the heading's bottom and whether the scroller is at its end.
 * @param tops - The sections' tops.
 * @param activationOffset - The activation line, below the scroller's top.
 * @returns The new state — the SAME object when nothing changed, so a React state update bails out. Pure.
 */
export function nextScrollState(
    previous: ScrollState,
    sample: ScrollSample,
    tops: readonly SectionTop[],
    activationOffset: number,
): ScrollState {
    const delta = sample.y - sample.previousY;
    const next: ScrollState = {
        condensed: sample.headingBottom !== undefined && sample.y >= sample.headingBottom,
        scrollingDown: Math.abs(delta) < DIRECTION_DEAD_ZONE_PX ? previous.scrollingDown : delta > 0,
        atTop: sample.y <= 0,
        current: currentSectionOf(tops, sample.y, activationOffset, sample.atEnd),
        viewportsDown: viewportsOf(Math.max(0, sample.y), sample.viewportHeight),
        pageViewports: viewportsOf(sample.contentHeight, sample.viewportHeight),
    };

    const same =
        next.condensed === previous.condensed &&
        next.scrollingDown === previous.scrollingDown &&
        next.atTop === previous.atTop &&
        next.current === previous.current &&
        next.viewportsDown === previous.viewportsDown &&
        next.pageViewports === previous.pageViewports;

    return same ? previous : next;
}

/** The state of a screen that has not scrolled. */
export const INITIAL_SCROLL_STATE: ScrollState = {
    condensed: false,
    scrollingDown: false,
    atTop: true,
    current: undefined,
    viewportsDown: 0,
    pageViewports: 0,
};
