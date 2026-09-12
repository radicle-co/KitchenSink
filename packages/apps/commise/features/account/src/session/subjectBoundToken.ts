/**
 * @module session/subjectBoundToken — a service client's bearer is minted only for the cook the client was built for.
 *
 * ⚠️ DELIBERATE — see `docs/architecture/decisions/0054-session-seam.md`. A client outlives a change of cook: a query
 * retry, an outbox drain or a mutation already in flight still holds the client it started with, and the client reads
 * its token at SEND time. Without this proxy, cook A's work is sent with cook B's token, which is a write into B's
 * account that A made. Rebuilding the clients when the cook changes is necessary and not sufficient, because it cannot
 * reach a client something else is still holding.
 *
 * The proxy reads the identity client's LIVE session twice: before the mint, so no token is minted for another cook,
 * and after it, because the session can change while a token is being minted.
 *
 * A client built while nobody was signed in is claimed by the first cook a token is minted for. That keeps the window
 * before the identity client names its cook working (mobile resolves the cook a render after mount), and it keeps the
 * claimed client from serving a second cook.
 *
 * Shared by both platforms' composition roots, which supply their own SDK's `useClerk()` and mint function, as
 * `signOutAndVerify` beside it is.
 *
 * @pattern Protection Proxy over the mint function — same signature, plus an access check on every call
 */

/**
 * The (structural) slice of the identity client the proxy reads: the live session's user. Satisfied by `useClerk()` on
 * either platform without either SDK being imported here. `undefined` before the SDK has loaded, `null` when signed out.
 */
export interface SessionSubjectSource {
    readonly session: { readonly user: { readonly id: string } | null | undefined } | null | undefined;
}

/**
 * A token was asked for on behalf of a cook whose session is no longer the live one. No request was sent.
 *
 * Its message names no user: it can reach a log or an error report.
 */
export class SessionSubjectChangedError extends Error {
    public constructor() {
        super('The signed-in session changed since this client was built, so no token was minted for its request');
        this.name = 'SessionSubjectChangedError';
        Object.setPrototypeOf(this, SessionSubjectChangedError.prototype);
    }
}

/** Type guard for {@link SessionSubjectChangedError}. */
export function isSessionSubjectChangedError(error: unknown): error is SessionSubjectChangedError {
    return error instanceof SessionSubjectChangedError;
}

/**
 * The user the identity client's live session belongs to.
 *
 * @param identity - The identity client.
 * @returns The user id, or `undefined` when no session is loaded or signed in. Pure.
 */
function liveSubjectOf(identity: SessionSubjectSource): string | undefined {
    return identity.session?.user?.id ?? undefined;
}

/**
 * Wrap `mint` so it mints only for `subject`, or, when `subject` is absent, only for the first cook it mints for.
 *
 * @param subject - The cook the client is built for (Clerk `userId`), or `undefined` when nobody was signed in.
 * @param identity - The identity client, read for its live session on every call (pass `useClerk()`).
 * @param mint - The platform's token mint; `forceRefresh` asks it to skip its cache.
 * @returns The bound mint. It rejects with {@link SessionSubjectChangedError} when the live session is not the cook's,
 *   before or after minting, and passes every other outcome of `mint` through unchanged.
 */
export function subjectBoundToken(
    subject: string | undefined,
    identity: SessionSubjectSource,
    mint: (forceRefresh: boolean) => Promise<string>,
): (forceRefresh: boolean) => Promise<string> {
    let owner = subject;

    /** @sideEffect Mints a token, and claims an unclaimed client for the cook it was minted for. */
    return async (forceRefresh: boolean): Promise<string> => {
        const before = liveSubjectOf(identity);

        // No session loaded yet is not a refusal: the mint is what waits for the identity client to load.
        if (owner !== undefined && before !== undefined && before !== owner) {
            throw new SessionSubjectChangedError();
        }

        const token = await mint(forceRefresh);
        const after = liveSubjectOf(identity);

        if (before !== undefined && after !== before) {
            throw new SessionSubjectChangedError();
        }

        if (owner === undefined) {
            if (after === undefined) {
                return token;
            }

            owner = after;
        }

        if (after !== owner) {
            throw new SessionSubjectChangedError();
        }

        return token;
    };
}
