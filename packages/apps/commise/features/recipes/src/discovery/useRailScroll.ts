'use client';

/**
 * @module @commise/features-recipes/discovery — Previous and Next for one browse rail's track (web, a fine pointer).
 *
 * The track is a scroll container, an external system with no declarative form: its position is read from `scroll` and
 * `ResizeObserver` events and its movement is `scrollBy`. This hook is the Adapter. It is handed the track element the
 * rail's callback ref captured, keeps the two ends' state current, and moves the track by one view less one card —
 * smoothly, or at once under `prefers-reduced-motion`.
 *
 * @pattern Adapter over an element's scroll position and `ResizeObserver`
 * @sideEffect Subscribes to the track's `scroll` events and resizes while it is mounted; `by` scrolls it.
 */
import { useEffect, useState } from 'react';

import { pageStepOf, railScrollState, type RailScrollState } from './railScroll.js';

/** Nothing is known until the track is measured: both buttons rest disabled. */
const UNMEASURED: RailScrollState = { atStart: true, atEnd: true };

/** What the rail's heading gets. */
export interface RailScrollControl extends RailScrollState {
    /** Scroll a page backward (`-1`) or forward (`1`). */
    readonly by: (direction: -1 | 1) => void;
}

/**
 * The scroll behaviour for a programmatic move.
 *
 * @returns `'auto'` under `prefers-reduced-motion: reduce`, else `'smooth'`.
 */
export function scrollBehaviorOf(): ScrollBehavior {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth';
}

/**
 * The first card's width in a track, or 0 before layout.
 *
 * @param track - The scroll container.
 * @returns The width in px.
 */
export function firstCardWidthOf(track: HTMLElement): number {
    return track.querySelector('li')?.getBoundingClientRect().width ?? 0;
}

/**
 * Follow one rail's track.
 *
 * @param track - The scroll container, or `null` before it mounts.
 * @returns Whether it is at either end, and the page scroll.
 */
export function useRailScroll(track: HTMLElement | null): RailScrollControl {
    const [state, setState] = useState<RailScrollState>(UNMEASURED);

    useEffect(() => {
        if (track === null) {
            return undefined;
        }

        const measure = (): void => {
            const next = railScrollState(track);

            setState((current) => (current.atStart === next.atStart && current.atEnd === next.atEnd ? current : next));
        };

        measure();
        track.addEventListener('scroll', measure, { passive: true });
        const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);

        observer?.observe(track);

        return () => {
            track.removeEventListener('scroll', measure);
            observer?.disconnect();
        };
    }, [track]);

    return {
        // No track, nothing to measure: derived here rather than reset in the effect, so a track that goes away reads as unmeasured.
        ...(track === null ? UNMEASURED : state),
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
