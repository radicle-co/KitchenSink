/**
 * The errors of the reference a remote hit carries (ADR-0055 point 10).
 *
 * @module
 */

/**
 * Why a reference cannot be opened.
 *
 * - `unreadable`: it is not a reference this key sealed: changed, sealed under another key (a rotation), malformed, or
 *   sealed with another algorithm.
 * - `version`: it decrypts, but its payload names a version this build does not know.
 * - `shape`: it decrypts, but its payload is not a reference.
 */
export type InvalidRemoteReferenceReason = 'unreadable' | 'version' | 'shape';

/** Thrown when a reference cannot be opened. The adopt command answers it as a hit that is no longer valid. */
export class InvalidRemoteReferenceError extends Error {
    /** Why it cannot be opened. */
    public readonly reason: InvalidRemoteReferenceReason;

    /** @param reason - Why it cannot be opened. */
    public constructor(reason: InvalidRemoteReferenceReason) {
        super(`The remote food reference cannot be opened: ${reason}`);
        this.name = 'InvalidRemoteReferenceError';
        this.reason = reason;
        Object.setPrototypeOf(this, InvalidRemoteReferenceError.prototype);
    }
}

/** Type guard for {@link InvalidRemoteReferenceError}. */
export function isInvalidRemoteReferenceError(error: unknown): error is InvalidRemoteReferenceError {
    return error instanceof InvalidRemoteReferenceError;
}
