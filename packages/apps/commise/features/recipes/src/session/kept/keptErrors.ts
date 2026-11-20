/**
 * The kept store's errors, each with its matching guard.
 */

/** Reported once per hydrate when a stored timer failed its schema and was dropped. Carries a count only. */
export class KeptTimersDroppedError extends Error {
    public constructor(public readonly count: number) {
        super(`Dropped ${count} unreadable kept timer(s)`);
        this.name = 'KeptTimersDroppedError';
        Object.setPrototypeOf(this, KeptTimersDroppedError.prototype);
    }
}

/**
 * Type guard for {@link KeptTimersDroppedError}.
 *
 * @param error - The reported value.
 * @returns `true` when `error` is a {@link KeptTimersDroppedError}.
 */
export function isKeptTimersDroppedError(error: unknown): error is KeptTimersDroppedError {
    return error instanceof KeptTimersDroppedError;
}
