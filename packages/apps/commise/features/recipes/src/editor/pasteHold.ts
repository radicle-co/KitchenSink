/**
 * @module @commise/features-recipes/editor — whether a pasted list is still joining the draft, held in ONE place that
 * both the paste and the editor are handed.
 *
 * The paste dispatches its lines into the editor, and the editor's server create must wait while a paste is still
 * joining (`serverWriteFor`'s `pastePending`, blueprint A5): each needs the other. Composed one after the other, the
 * second one's answer could only reach the first as state copied during render. So the hold is made BEFORE both, the
 * way the lane is (`writeLane.ts`): the paste writes it where its own state changes, and the editor reads it when a
 * checkpoint runs, which is the only time it matters. Neither renders from it.
 *
 * @pattern Shared state holder — one mutable cell with a single writer (the paste) and a single reader (the editor)
 */

/** Whether a paste is joining the draft. */
export interface PasteHold {
    /** Whether a paste is being sent or its lines are still joining. Read when a checkpoint runs. */
    readonly get: () => boolean;
    /**
     * The paste says whether it is joining, where its own state changes. Letting go of a hold that was taken tells the
     * listeners (A-021).
     */
    readonly set: (pending: boolean) => void;
    /** The paste went away: the hold is cleared without telling anyone, for there is nobody left to checkpoint for. */
    readonly discard: () => void;
    /**
     * Hear the hold being let go of, so the editor can run the checkpoint the hold deferred: a paste whose lines join as
     * no rows leaves the draft unchanged, and nothing else would re-arm it.
     *
     * @returns The unsubscribe.
     */
    readonly onReleased: (listener: () => void) => () => void;
}

/**
 * A paste hold, not holding.
 *
 * @returns The hold. @sideEffect Its `set` changes what every later `get` answers, and may call a listener.
 */
export function createPasteHold(): PasteHold {
    let pending = false;
    const listeners = new Set<() => void>();

    return {
        get: () => pending,
        set: (next) => {
            const released = pending && !next;
            pending = next;

            if (released) {
                for (const listener of [...listeners]) {
                    listener();
                }
            }
        },
        discard: () => {
            pending = false;
        },
        onReleased: (listener) => {
            listeners.add(listener);

            return () => {
                listeners.delete(listener);
            };
        },
    };
}
