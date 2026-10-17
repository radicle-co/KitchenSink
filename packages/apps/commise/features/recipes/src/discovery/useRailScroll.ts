'use client';

/**
 * @module @commise/features-recipes/discovery — Previous and Next for one browse rail's track (web, a fine pointer).
 *
 * The track is a scroll container, an external system with no declarative form. This hook is the Adapter for its
 * movement: it is handed the track element the rail's callback ref captured and moves it by one view less one card —
 * smoothly, or at once under `prefers-reduced-motion`. Where the track rests is not read here: the design-system
 * `HorizontalScroller` measures it once and reports it, and the scroll hint reads the same report.
 *
 * @pattern Adapter over an element's `scrollBy`
 * @sideEffect `by` scrolls the track.
 */
import { UNMEASURED_EXTENT, scrollBehaviorOf, type ScrollExtent } from '@commise/ui/horizontal-scroller';

import { pageStepOf } from './railScroll.js';

/** What the rail's heading gets. */
export interface RailScrollControl {
    /** Scrolled to the start (or not scrollable at all): Previous has nowhere to go. */
    readonly atStart: boolean;
    /** Scrolled to the end (or not scrollable at all): Next has nowhere to go. */
    readonly atEnd: boolean;
    /** Scroll a page backward (`-1`) or forward (`1`). */
    readonly by: (direction: -1 | 1) => void;
}

/**
 * The first card's width in a track, or 0 before layout.
 *
 * @param track - The scroll container.
 * @returns The width in px.
 */
function firstCardWidthOf(track: HTMLElement): number {
    return track.querySelector('li')?.getBoundingClientRect().width ?? 0;
}

/**
 * Previous and Next for one rail's track. Where the track rests comes from the track itself (its `onPosition`), so a
 * button and the scroll hint cannot disagree; this hook only moves it.
 *
 * @param track - The scroll container, or `null` before it mounts.
 * @param position - Where the track reports it rests.
 * @returns Whether it is at either end, and the page scroll.
 */
export function useRailScroll(track: HTMLElement | null, position: ScrollExtent): RailScrollControl {
    // No track, nothing to measure: derived here rather than reset, so a track that goes away reads as unmeasured.
    const { atStart, atEnd } = track === null ? UNMEASURED_EXTENT : position;

    return {
        atStart,
        atEnd,
        by: (direction) => {
            if (track === null) {
                return;
            }

            track.scrollBy({
                left: direction * pageStepOf(firstCardWidthOf(track), track.clientWidth),
                behavior: scrollBehaviorOf(),
            });
        },
    };
}
