'use client';

/**
 * @module @commise/features-recipes — `useIngredientsCardScrolledPast`: whether the ingredients card has scrolled ABOVE the
 * top of the window, which is when the pinned ingredients bar is drawn (owner ruling R1,
 * `docs/plans/2026-11-08-pinnedIngredientsBar.md`).
 *
 * One `IntersectionObserver`, no scroll listener, on a zero-height marker at the card's END. Its root is stretched
 * upward and shrunk to nothing at the bottom, so the root is "everything above the top edge of the window": the marker
 * intersects it exactly when the card's bottom edge is at or above that edge, which is "the card has scrolled away".
 * ⚠️ That shape is deliberate. An observer on the card itself says "not intersecting" both before the cook reaches it and
 * after the cook has passed it, and is told nothing when a jump (an anchor, a find-in-page, the End key) goes from one
 * to the other in a single frame, so the bar would never appear. A root that INCLUDES the far side changes state on
 * that jump.
 *
 * The recipe page has no sticky top chrome of its own (its Back is a disc on the photo), so the edge is the window's top.
 * If a pinned bar is ever added to this page, the top margin is where its height goes.
 *
 * @pattern Adapter over IntersectionObserver — an external, non-declarative system; the callback ref IS the handle.
 */
import { useCallback, useState, type RefCallback } from 'react';

/** Far above any page, in px: the root reaches up this far, so a marker scrolled out of sight above still intersects. */
const ROOT_REACH_ABOVE_PX = 1_000_000;

/** What {@link useIngredientsCardScrolledPast} gives the shell. */
export interface IngredientsCardWatch {
    /** Attach to the zero-height marker at the end of the ingredients card. */
    readonly cardEndRef: RefCallback<HTMLElement>;
    /** The card's bottom edge is at or above the top of the window. */
    readonly scrolledPast: boolean;
}

/**
 * Watch the end of the ingredients card.
 *
 * @returns The marker's ref and whether the card has scrolled above the window.
 * @sideEffect Observes the marker with the browser's `IntersectionObserver` while it is mounted.
 */
export function useIngredientsCardScrolledPast(): IngredientsCardWatch {
    const [scrolledPast, setScrolledPast] = useState(false);
    const cardEndRef = useCallback<RefCallback<HTMLElement>>((marker) => {
        if (marker === null) {
            return undefined;
        }

        const observer = new IntersectionObserver(
            (entries) => {
                // The last entry is the latest word; `noUncheckedIndexedAccess` is off, so the guard stays.
                const entry = entries[entries.length - 1];

                if (entry !== undefined) {
                    setScrolledPast(entry.isIntersecting);
                }
            },
            { rootMargin: `${String(ROOT_REACH_ABOVE_PX)}px 0px -100% 0px` },
        );

        observer.observe(marker);

        return () => {
            observer.disconnect();
        };
    }, []);

    return { cardEndRef, scrolledPast };
}
