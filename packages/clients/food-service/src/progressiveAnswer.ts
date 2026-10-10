/**
 * The progressive food search's answer so far: the frames read from its body (`./progressiveFrames.ts`) folded into one
 * value (ADR-0055 points 5 and 9). TanStack's `experimental_streamedQuery` folds each arriving frame into the cached
 * answer with {@link withProgressiveFrame}, so the list re-renders once per frame.
 *
 * - The database frame comes first and once; a second is ignored.
 * - Each source keeps the first frame it sent, in arrival order, so a group that has shown never moves.
 * - `complete` ends the answer: nothing after it changes the answer. An answer without it is incomplete.
 *
 * Pure: no React, no client.
 *
 * @pattern Reducer — a pure fold over the frame union, with an exhaustive switch
 */
import type { DatabaseFrame } from '@kitchensink/schema-food';

import type { ProgressiveFrame, ProgressiveSourceFrame } from './progressiveFrames.js';

/** What the progressive search has answered so far. */
export interface ProgressiveAnswer {
    /** Our database's two groups, once their frame has arrived. */
    readonly database: DatabaseFrame | undefined;
    /** Each remote source's frame, in the order they arrived. */
    readonly sources: readonly ProgressiveSourceFrame[];
    /** The `complete` frame arrived: every source has answered or been closed. */
    readonly complete: boolean;
}

/** The answer before any frame has arrived. */
export const EMPTY_PROGRESSIVE_ANSWER: ProgressiveAnswer = { database: undefined, sources: [], complete: false };

/**
 * The answer with one more frame. A frame it ignores returns the same object, so nothing re-renders for it. Pure.
 *
 * @param answer - The answer so far.
 * @param frame - The frame that arrived.
 * @returns The answer.
 */
export function withProgressiveFrame(answer: ProgressiveAnswer, frame: ProgressiveFrame): ProgressiveAnswer {
    if (answer.complete) {
        return answer;
    }

    switch (frame.type) {
        case 'database':
            return answer.database === undefined ? { ...answer, database: frame } : answer;
        case 'source':
            return answer.sources.some((each) => each.source === frame.source)
                ? answer
                : { ...answer, sources: [...answer.sources, frame] };
        case 'complete':
            return { ...answer, complete: true };

        default: {
            const unhandled: never = frame;

            return unhandled;
        }
    }
}
