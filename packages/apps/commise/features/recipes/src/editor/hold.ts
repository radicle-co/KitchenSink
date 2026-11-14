/**
 * @module @commise/features-recipes/editor — a fact that holds the editor's server checkpoints back, kept in ONE place
 * that both its writer and the editor are handed.
 *
 * Two facts use it, each with its own cell:
 * - A paste is still joining the draft. The paste dispatches its lines into the editor, and the editor's server create
 *   must wait while it joins (`serverWriteFor`'s `pastePending`, blueprint A5): each needs the other.
 * - A row editor is open. Its Cancel puts the line back, and a server write made meanwhile makes the server drop that
 *   line's source and review flag, which Cancel cannot bring back (`serverWriteFor`'s `rowEditHeld`).
 *
 * Composed one after the other, the second one's answer could only reach the first as state copied during render. So the
 * hold is made BEFORE both, the way the lane is (`writeLane.ts`): the writer sets it where its own state changes, and the
 * editor reads it when a checkpoint runs, which is the only time it matters. Neither renders from it.
 *
 * @pattern Shared state holder — one mutable cell with a single writer and a single reader (the editor)
 */

/** Whether something is holding the editor's server checkpoints back. */
export interface Hold {
    /** Whether the hold is raised. Read when a checkpoint runs. */
    readonly get: () => boolean;
    /**
     * The writer says whether the hold is raised, where its own state changes. Letting go of a hold that was raised tells
     * the listeners (A-021).
     */
    readonly set: (held: boolean) => void;
    /** The writer went away: the hold is cleared without telling anyone, for there is nobody left to checkpoint for. */
    readonly discard: () => void;
    /**
     * Hear the hold being let go of, so the editor can run the checkpoint the hold deferred: a paste whose lines join as
     * no rows, or an editor closed with nothing changed, leaves the draft as it was, and nothing else would re-arm it.
     *
     * @returns The unsubscribe.
     */
    readonly onReleased: (listener: () => void) => () => void;
}

/**
 * A hold, not raised.
 *
 * @returns The hold. @sideEffect Its `set` changes what every later `get` answers, and may call a listener.
 */
export function createHold(): Hold {
    let raised = false;
    const listeners = new Set<() => void>();

    return {
        get: () => raised,
        set: (next) => {
            const released = raised && !next;
            raised = next;

            if (released) {
                for (const listener of [...listeners]) {
                    listener();
                }
            }
        },
        discard: () => {
            raised = false;
        },
        onReleased: (listener) => {
            listeners.add(listener);

            return () => {
                listeners.delete(listener);
            };
        },
    };
}
