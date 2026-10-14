/**
 * @module session/tokenMintFailedError — the error `subjectBoundToken` raises when the platform's mint cannot produce a
 * token. Its own file because a file does one thing (CODING_STANDARDS §1).
 */

/**
 * The platform's mint could not produce a token (Clerk could not refresh a session token with no network, or the web
 * provider's typed "not ready" while Clerk hydrates). The original failure is the `cause`. No request was sent: the
 * token is minted before the request, so the outbox can park the record as "no credential" and send it again once there
 * is one, instead of reading a statusless failure as an unknown outcome that only the cook may resolve.
 *
 * Its message names no user: it can reach a log or an error report.
 */
export class TokenMintFailedError extends Error {
    public constructor(cause: unknown) {
        super('A session token could not be minted, so no request was sent', { cause });
        this.name = 'TokenMintFailedError';
        Object.setPrototypeOf(this, TokenMintFailedError.prototype);
    }
}

/** Type guard for {@link TokenMintFailedError}. */
export function isTokenMintFailedError(error: unknown): error is TokenMintFailedError {
    return error instanceof TokenMintFailedError;
}
