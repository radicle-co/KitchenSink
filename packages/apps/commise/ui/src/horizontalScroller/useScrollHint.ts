'use client';

/**
 * @module @commise/ui/horizontal-scroller — the web scroll hint's connection to its scroll container.
 *
 * A scroll container is an external system with no declarative form: its position arrives as `scroll` events and its
 * size as `ResizeObserver` entries. This hook is the Adapter. It keeps where the scroller rests current, marks it
 * `data-scrolling` while the reader scrolls, and reports the position to the owner.
 *
 * The elements arrive through callback refs held in state, so the effect re-subscribes when one is replaced and no ref
 * object is needed. `data-scrolling` is written straight onto the element (a scroll event fires every frame, and React
 * state would re-render the scroller each time); state changes only when the scroller reaches or leaves an end.
 *
 * @pattern Adapter over a scroll container's position and ResizeObserver
 * @sideEffect Subscribes to the scroller's `scroll` and `scrollend` events and to the size of the scroller and its
 *     content while mounted; writes `data-scrolling` on the scroller.
 */
import { useCallback, useEffect, useEffectEvent, useState } from 'react';

import { UNMEASURED_EXTENT, scrollExtentOf, startOffsetOf, type ScrollExtent } from './scrollHint.js';

/** How long after the last `scroll` event the scroller stops counting as scrolling, when no `scrollend` arrives. */
export const SCROLLING_LINGER_MS = 500;

/** What the leaf needs to draw the hint. */
export interface ScrollHintBinding {
    /** The ref for the scroll element. Stable while the owner's `onScroller` is. */
    readonly setScroller: (element: HTMLElement | null) => void;
    /** The ref for the box that holds the content. */
    readonly setContent: (element: HTMLElement | null) => void;
    /** Where the scroller rests. */
    readonly extent: ScrollExtent;
}

/** Whether two extents say the same thing. Pure. */
function sameExtent(a: ScrollExtent, b: ScrollExtent): boolean {
    return a.measured === b.measured && a.overflows === b.overflows && a.atStart === b.atStart && a.atEnd === b.atEnd;
}

/**
 * Follow one scroller.
 *
 * @param onScroller - The owner's callback for the scroll element.
 * @param onPosition - The owner's callback for where the scroller rests.
 * @returns The two refs and where the scroller rests.
 */
export function useScrollHint(
    onScroller: ((element: HTMLElement | null) => void) | undefined,
    onPosition: ((extent: ScrollExtent) => void) | undefined,
): ScrollHintBinding {
    const [scroller, setScrollerElement] = useState<HTMLElement | null>(null);
    const [content, setContent] = useState<HTMLElement | null>(null);
    const [extent, setExtent] = useState<ScrollExtent>(UNMEASURED_EXTENT);

    const setScroller = useCallback(
        (element: HTMLElement | null): void => {
            setScrollerElement(element);
            onScroller?.(element);
        },
        [onScroller],
    );

    useEffect(() => {
        if (scroller === null) {
            return undefined;
        }

        let linger: ReturnType<typeof setTimeout> | undefined;

        const measure = (): void => {
            const { scrollLeft, clientWidth, scrollWidth } = scroller;
            const rtl = getComputedStyle(scroller).direction === 'rtl';
            const next = scrollExtentOf({
                startOffset: startOffsetOf(scrollLeft, clientWidth, scrollWidth, rtl, 'web'),
                viewport: clientWidth,
                content: scrollWidth,
            });

            setExtent((current) => (sameExtent(current, next) ? current : next));
        };

        const stopScrolling = (): void => {
            clearTimeout(linger);
            scroller.removeAttribute('data-scrolling');
        };

        const onScroll = (): void => {
            scroller.setAttribute('data-scrolling', '');
            clearTimeout(linger);
            linger = setTimeout(stopScrolling, SCROLLING_LINGER_MS);
            measure();
        };

        measure();
        scroller.addEventListener('scroll', onScroll, { passive: true });
        scroller.addEventListener('scrollend', stopScrolling);

        const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);

        observer?.observe(scroller);

        if (content !== null) {
            observer?.observe(content);
        }

        return () => {
            scroller.removeEventListener('scroll', onScroll);
            scroller.removeEventListener('scrollend', stopScrolling);
            observer?.disconnect();
            stopScrolling();
        };
    }, [scroller, content]);

    // Reported from an effect on the extent itself, which changes only when a boundary flips; the owner's callback is
    // read at call time, so a new function from the owner neither re-reports nor re-subscribes.
    const report = useEffectEvent((current: ScrollExtent): void => onPosition?.(current));

    useEffect(() => {
        report(extent);
    }, [extent]);

    return { setScroller, setContent, extent };
}
