/**
 * @module @kitchensink/sync — a serial queue: run async work one piece at a time, in call order.
 *
 * The one mechanism behind "one writer per storage key". A read-modify-write that awaits between its read and its
 * write is safe only while no second one interleaves with it; queueing them is how both the outbox mutator and the
 * editor's draft store keep their key consistent without a lock primitive the platforms do not share.
 *
 * @pattern Mutex over a promise chain — callers enqueue work and get its promise; the chain runs one at a time
 */

/** Runs `work` after everything queued before it has settled, and resolves or rejects with `work`'s own result. */
export type SerialQueue = <T>(work: () => Promise<T>) => Promise<T>;

/**
 * A new, empty queue.
 *
 * @returns The queue. A rejection settles only its own caller's promise; the work after it still runs.
 */
export function createSerialQueue(): SerialQueue {
    let tail: Promise<unknown> = Promise.resolve();

    return <T>(work: () => Promise<T>): Promise<T> => {
        const run = tail.then(work, work);

        tail = run.catch(() => undefined);

        return run;
    };
}
