/**
 * @module @commise/ui/live-region — which of a `LiveRegion`'s two regions holds its message (R8,
 * `docs/design/rowEditorOpenDecisions.md`). Shared by the native and web leaves.
 */
import { useState } from 'react';

/** The region that holds the message: the first or the second. */
export type OccurrenceSlot = 0 | 1;

/**
 * The region that holds the message: it changes at every change of `occurrence`, so the message lands on a region that
 * was empty and is spoken again. It moves on any change, not by the count's parity, because a count can also go down
 * (a limit window ending resets it), and a move by parity could then put the same text in the same region twice.
 *
 * Adjusted during render from the previous render's occurrence (React's "store information from previous renders"
 * pattern), so no ref and no effect.
 *
 * @param occurrence - The caller's event count, or `undefined` for a single region.
 * @returns The slot that holds the message.
 */
export function useOccurrenceSlot(occurrence: number | undefined): OccurrenceSlot {
    const [seen, setSeen] = useState(occurrence);
    const [slot, setSlot] = useState<OccurrenceSlot>(0);

    if (occurrence !== seen) {
        setSeen(occurrence);
        setSlot((current) => (current === 0 ? 1 : 0));
    }

    return slot;
}
