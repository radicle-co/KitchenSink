/**
 * @module @kitchensink/difference-check: the one error the check throws.
 *
 * It means v1 cannot give an answer on this runtime. The caller treats it as a failed check: no fact is recorded, and it
 * raises the error alarm. It is never a failed save.
 */

/** Why the check could not run. */
export type DifferenceCheckErrorReason = 'runtime-unicode';

/** The check could not run. */
export class DifferenceCheckError extends Error {
    readonly reason: DifferenceCheckErrorReason;

    constructor(reason: DifferenceCheckErrorReason, message: string) {
        super(message);
        Object.setPrototypeOf(this, DifferenceCheckError.prototype);
        this.name = 'DifferenceCheckError';
        this.reason = reason;
    }
}

/**
 * Whether a thrown value is a {@link DifferenceCheckError}.
 *
 * @param error - Anything that was thrown.
 * @returns `true` for the check's own error. Pure.
 */
export function isDifferenceCheckError(error: unknown): error is DifferenceCheckError {
    return error instanceof DifferenceCheckError;
}
