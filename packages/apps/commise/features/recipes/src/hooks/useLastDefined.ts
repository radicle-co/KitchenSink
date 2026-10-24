/**
 * @module @commise/features-recipes/hooks — what a surface that is closing still shows: the value it last held. A sheet
 * or a dialog animates out after its state has gone, and drawing nothing for those frames would blank its title and
 * its body as it leaves.
 *
 * @pattern Memento — the last defined value, kept during render by React's "store information from previous renders"
 *     form, so no effect and no ref holds it
 */
import { useState } from 'react';

/**
 * The value, or while it is `undefined`, the last value it held.
 *
 * @param value - The current value; `undefined` while there is none.
 * @returns `value` while it is defined, else the last defined value, else `undefined`.
 */
export function useLastDefined<T>(value: T | undefined): T | undefined {
    const [last, setLast] = useState(value);

    if (value !== undefined && value !== last) {
        setLast(value);
    }

    return value ?? last;
}
