/**
 * The errors of food's boundary with the remote search service (ADR-0055 points 6 and 7).
 *
 * @module
 */
import type { CallableApiSourceId } from '../sourceRegister.js';

/**
 * Why an answer from the search service's CDN cannot be read as this request's.
 *
 * - `noEcho`: the response carries no request-id echo, so the search service did not produce it (the function URL's
 *   own throttle, a CDN error page, a failed signature).
 * - `foreignEcho`: a response that is never cached echoes another request.
 * - `unexpectedStatus`: a status the contract does not give to the request it answers.
 */
export type RemoteSearchUnavailableReason = 'noEcho' | 'foreignEcho' | 'unexpectedStatus';

/**
 * Thrown when the search service's answer cannot be trusted as this request's. The source is never blocked on it: the
 * source's own signals arrive only in a response that echoes this request (ADR-0055 point 6).
 */
export class RemoteSearchUnavailableError extends Error {
    /** The source the search was for. */
    public readonly source: CallableApiSourceId;
    /** Why the answer was refused. */
    public readonly reason: RemoteSearchUnavailableReason;
    /** The HTTP status the CDN answered with. */
    public readonly status: number;

    /**
     * @param source - The source the search was for.
     * @param reason - Why the answer was refused.
     * @param status - The HTTP status the CDN answered with.
     */
    public constructor(source: CallableApiSourceId, reason: RemoteSearchUnavailableReason, status: number) {
        super(`The search service's answer for '${source}' (${String(status)}) is not this request's: ${reason}`);
        this.name = 'RemoteSearchUnavailableError';
        this.source = source;
        this.reason = reason;
        this.status = status;
        Object.setPrototypeOf(this, RemoteSearchUnavailableError.prototype);
    }
}

/** Type guard for {@link RemoteSearchUnavailableError}. */
export function isRemoteSearchUnavailableError(error: unknown): error is RemoteSearchUnavailableError {
    return error instanceof RemoteSearchUnavailableError;
}
