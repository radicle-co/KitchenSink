/**
 * `boundedBy` — ends a WAIT at a request deadline, without pretending to cancel the work (ADR-0071).
 *
 * DESIGN PATTERN: **Timeout / Circuit-breaker style bulkhead on a wait**, hand-written because nothing the service
 * already depends on does it: `p-timeout` is not a dependency of this image, and the primitive is an `AbortSignal` race.
 *
 * `pg` can neither cancel a pool acquire nor recall a statement it has sent. So a request that wants an answer by a
 * deadline stops WAITING at the deadline and lets the work finish in the background. That is safe for a read, and for
 * a write whose late landing is harmless. For a write whose late landing is NOT harmless (a claim nobody will send),
 * the caller passes `onLate`, which receives the result that arrives after the deadline so it can be undone.
 */

/** Thrown when the deadline fires before the work finished. The work itself is NOT cancelled. */
export class DeadlineExceededError extends Error {
    public constructor() {
        super('The request deadline passed before the work finished.');
        this.name = 'DeadlineExceededError';

        Object.setPrototypeOf(this, DeadlineExceededError.prototype);
    }
}

/** Type guard for {@link DeadlineExceededError}. */
export function isDeadlineExceededError(value: unknown): value is DeadlineExceededError {
    return value instanceof DeadlineExceededError;
}

/**
 * Run `work`, and stop waiting for it when `deadline` fires.
 *
 * @param deadline - The request's deadline signal.
 * @param work - Starts the work. ⛔ A thunk, not a promise: past the deadline the work is never started at all.
 * @param onLate - Receives the work's result when it lands AFTER the deadline gave up on it. Its failure is swallowed.
 * @returns The work's result.
 * @throws {DeadlineExceededError} when the deadline fired first. Otherwise whatever `work` throws.
 * @sideEffect Starts `work`. Attaches, then removes, one listener on `deadline`.
 */
export async function boundedBy<T>(
    deadline: AbortSignal,
    work: () => Promise<T>,
    onLate?: (value: T) => void | Promise<void>,
): Promise<T> {
    if (deadline.aborted) {
        throw new DeadlineExceededError();
    }

    const started = work();
    let gaveUp = false;
    let onAbort: () => void = () => undefined;
    const expired = new Promise<never>((_resolve, reject) => {
        onAbort = () => {
            gaveUp = true;
            reject(new DeadlineExceededError());
        };
        deadline.addEventListener('abort', onAbort, { once: true });
    });

    // Whatever happens to the abandoned work must not surface as an unhandled rejection or an unhandled late result.
    started.then(
        (value) => {
            if (gaveUp && onLate !== undefined) {
                Promise.resolve(onLate(value)).catch(() => undefined);
            }
        },
        () => undefined,
    );

    try {
        return await Promise.race([started, expired]);
    } finally {
        deadline.removeEventListener('abort', onAbort);
        // `expired` may never settle; it holds nothing once the listener is gone.
        expired.catch(() => undefined);
    }
}
