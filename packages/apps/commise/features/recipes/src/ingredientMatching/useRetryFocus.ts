/**
 * @module @commise/features-recipes/ingredientMatching — the holder of `retryFocus.ts`'s memory: the one hook every
 * surface that shows a failed pick calls, so a retry's focus is decided in one place for the matched-line list, the paste
 * pane, the flagged list, and the import options sheet and pane, on both platforms.
 *
 * @pattern Memento — the previous render's send states, kept as state adjusted during render (React's documented way
 *     to derive state from a change in props), so the hook holds no ref and runs no effect
 */
import { useState } from 'react';

import type { ControlFocus } from '../common/controlFocus.js';
import {
    lowerRetryRequest,
    noteAttention as noteMemoryAttention,
    ownsFocus as memoryOwnsFocus,
    startRetryMemory,
    stepRetryMemory,
    type RetryFocus,
    type SendState,
} from './retryFocus.js';

/** The two focus requests a line's Try again raises: for the control the retry made busy, and for the new Try again. */
export interface LineRetryFocus {
    /** Take focus on the control the retry made busy. */
    readonly landing: ControlFocus;
    /** Take focus on the Try again that comes back when the retry fails again. */
    readonly tryAgain: ControlFocus;
}

/**
 * What the hook returns: a function from a line's key to its two requests (every existing caller uses it as that), that
 * also carries the cook's ATTENTION. Try again must not steal focus: a host row handler calls `noteAttention(key)` in the
 * press, and a host's own focus move after a successful retry runs only if `ownsFocus(key)`.
 */
export interface RetryFocusOf {
    (key: string): LineRetryFocus;
    /** The cook acted on this line: requests standing for every other line are dropped and none rises for them. */
    readonly noteAttention: (key: string) => void;
    /** Whether the line may take focus from the host: the cook is on it, or has acted on no line yet. */
    readonly ownsFocus: (key: string) => boolean;
}

/**
 * Hold what Try again needs to keep focus on a surface, for the lines it draws.
 *
 * The memory is state adjusted during the render that sees a change, the documented React way to derive state from a
 * change in props: the request is raised in the very render that unmounts Try again, so the control it names takes focus
 * in that render's commit and there is no frame with focus on the page. It holds no ref and runs no effect.
 *
 * @param sends - The state of each line drawn with a Try again or a control a retry lands on.
 * @returns A function from a line's key to its two requests, with `noteAttention` and `ownsFocus` on it.
 * @sideEffect Updates its own state during render when a line's send state changed; `noteAttention` updates it too.
 */
export function useRetryFocus(sends: readonly SendState[]): RetryFocusOf {
    const [memory, setMemory] = useState(() => startRetryMemory(sends));
    const next = stepRetryMemory(memory, sends);

    if (next !== memory) {
        setMemory(next);
    }

    const focusOf = (key: string, request: RetryFocus): ControlFocus => ({
        requested: next.requests.get(key) === request,
        onHandled: () => {
            setMemory((current) => lowerRetryRequest(current, key, request));
        },
    });

    return Object.assign(
        (key: string): LineRetryFocus => ({ landing: focusOf(key, 'landing'), tryAgain: focusOf(key, 'tryAgain') }),
        {
            noteAttention: (key: string) => {
                setMemory((current) => noteMemoryAttention(current, key));
            },
            ownsFocus: (key: string) => memoryOwnsFocus(next, key),
        },
    );
}
