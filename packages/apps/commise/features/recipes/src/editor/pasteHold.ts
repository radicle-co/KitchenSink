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
    /** The paste says whether it is joining, where its own state changes. */
    readonly set: (pending: boolean) => void;
}

/**
 * A paste hold, not holding.
 *
 * @returns The hold. @sideEffect Its `set` changes what every later `get` answers.
 */
export function createPasteHold(): PasteHold {
    let pending = false;

    return {
        get: () => pending,
        set: (next) => {
            pending = next;
        },
    };
}
