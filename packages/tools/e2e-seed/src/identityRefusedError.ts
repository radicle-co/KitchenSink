/**
 * Identity answered a call with a FINAL refusal (a non-transient 4xx), so retrying cannot help. It carries the status,
 * because callers that tell one refusal from another (the settings reset reads a `404` as "this server predates the
 * route") must read the status, not match the message text.
 */

/** Identity refused the call with `status`; the message names the request and the status. */
export class IdentityRefusedError extends Error {
    public readonly status: number;

    public constructor(message: string, status: number) {
        super(message);
        this.name = 'IdentityRefusedError';
        this.status = status;
        Object.setPrototypeOf(this, IdentityRefusedError.prototype);
    }
}

/**
 * Whether a value is an {@link IdentityRefusedError}. Pure.
 *
 * @param error - Anything caught.
 * @returns True for an instance of the class.
 */
export function isIdentityRefusedError(error: unknown): error is IdentityRefusedError {
    return error instanceof IdentityRefusedError;
}
