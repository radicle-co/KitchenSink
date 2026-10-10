/**
 * @module @commise/features-recipes/hooks — one deadline per key, for the ingredient entry's food search
 * (`docs/design/rowEditorOpenDecisions.md`, S7 list contract P3): the database frame's deadline and the whole
 * answer's, each counted from the request for one text. The food client's own timer bounds only the response
 * headers; these bound the stream.
 *
 * A new key starts a new deadline, and a key the cook comes back to starts a fresh one, so a text asked again is never
 * read as already out of time. No ref and no state set inside an effect: the deadline's state names the key it belongs
 * to, and a render for another key resets it.
 *
 * ⚠️ A timer names the key it was set for, and does nothing once that key is gone. React clears the previous key's
 * timer in a passive effect, which runs after the new key has committed (after paint, for a key set from a timer, as a
 * debounced text is), so the old timer can fire in between. Without the check it would call the NEW key's `onExpire`.
 *
 * @pattern Timeout — a deadline per key, restarted when the key changes
 */
import { useEffect, useEffectEvent, useState } from 'react';

/** Which key the deadline belongs to, and whether it has fired. */
interface Deadline {
    readonly key: string | undefined;
    readonly expired: boolean;
}

/**
 * Whether the deadline for `key` has passed.
 *
 * @param key - What the deadline covers (the text being searched); `undefined` runs none.
 * @param ms - How long each key gets.
 * @param onExpire - Called once when a key's deadline passes. The latest one is called, and a new one does not restart
 *   the deadline.
 * @returns `true` once the current key's deadline has passed.
 * @sideEffect Schedules a timer for each key, cleared when the key changes or the caller unmounts.
 */
export function useReadDeadline(key: string | undefined, ms: number, onExpire: () => void): boolean {
    const [deadline, setDeadline] = useState<Deadline>({ key, expired: false });
    const expire = useEffectEvent((timerKey: string): void => {
        if (timerKey !== key) {
            return;
        }

        setDeadline({ key: timerKey, expired: true });
        onExpire();
    });

    // A render for another key starts that key afresh (React's "adjust state when a prop changes"): React re-renders
    // at once, before anything shows, so the previous key's expiry is never returned for this one.
    if (deadline.key !== key) {
        setDeadline({ key, expired: false });
    }

    useEffect(() => {
        if (key === undefined) {
            return undefined;
        }

        const timer = setTimeout(() => {
            expire(key);
        }, ms);

        return () => {
            clearTimeout(timer);
        };
    }, [key, ms]);

    return deadline.expired;
}
