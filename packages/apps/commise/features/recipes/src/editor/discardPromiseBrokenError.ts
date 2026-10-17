/**
 * @module @commise/features-recipes/editor/discardPromiseBrokenError — the error the editor reports when a Discard's
 * confirm promised the recipe stays as it was, and the outbox found, when it acted, that a discarded write may stand.
 */

/**
 * A Discard's confirm said the recipe stays as it was, and the outbox found the parked write it was to withdraw already
 * on its way or settled (`applyDiscard` answered `mayStand`). The cook has been told something false; this reaches the
 * error reporter so the gap is seen.
 */
export class DiscardPromiseBrokenError extends Error {
    public constructor(message = 'A Discard promised the recipe stays as it was, but a discarded save may stand') {
        super(message);
        this.name = 'DiscardPromiseBrokenError';
        Object.setPrototypeOf(this, DiscardPromiseBrokenError.prototype);
    }
}

/** Type guard for {@link DiscardPromiseBrokenError}. */
export function isDiscardPromiseBrokenError(error: unknown): error is DiscardPromiseBrokenError {
    return error instanceof DiscardPromiseBrokenError;
}
