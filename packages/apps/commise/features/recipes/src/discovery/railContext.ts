/**
 * @module @commise/features-recipes/discovery — what a browse rail hands the track its body renders.
 *
 * A rail's heading (with Previous and Next) sits OUTSIDE the rail's read boundary, and its track sits inside, so the two
 * meet through the render tree: the rail provides this context around its body, and the track reads it. The track is
 * handed to the rail as a state-holding callback ref, so the rail re-renders when the track mounts or is replaced (the
 * loading track gives way to the loaded one).
 *
 * @pattern Provider — the rail carries its name and its track hook to the track without threading props through the body
 */
import { createContext } from 'react';

/** What a rail gives its track. */
export interface RailScroll {
    /** The rail's title, which names the track's region ("Trending" → "Trending recipes"). */
    readonly title: string;
    /** Hands the rail its scroll container. Web only: native has no Previous and Next, so its rail needs no element. */
    readonly trackRef?: (node: HTMLElement | null) => void;
}

/** Absent when a track is drawn outside a rail: the track is then an unnamed scroller. */
export const RailContext = createContext<RailScroll | undefined>(undefined);
