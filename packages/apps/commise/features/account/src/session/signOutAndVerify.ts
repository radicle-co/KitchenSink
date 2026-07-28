/**
 * @module session/signOutAndVerify — the CROSS-PLATFORM core of the app's sign-out command.
 *
 * ⚠️ DELIBERATE — see `docs/architecture/decisions/0009-clerk-signout-load-gate.md` before dropping the
 * post-condition or the `error`-status short-circuit. Undoing either restores a sign-out that RESOLVES
 * without revoking, and tells the viewer they left when they did not.
 *
 * Pattern: **Command** — one authoritative representation of "end this viewer's session, and prove it
 * ended". The platform hooks (`useSignOutAndLeave` on web, `useSignOutAndVerify` on mobile) are thin
 * **adapters**: each supplies its own SDK's load-safe `signOut` plus its client object, and owns whatever
 * "leaving" means on that platform (web replaces the document; mobile's auth gate re-renders on its own).
 * This module owns the part that is identical on both and must never diverge — the ordering, and the
 * fail-closed post-condition.
 *
 * **Why the post-condition is the load-bearing guard.** Clerk exposes two `signOut`s and only one is
 * load-safe: `useAuth().signOut` awaits clerk-js (`createSignOut` → `await clerkLoaded(clerk)`), while
 * `useClerk().signOut` is the raw `IsomorphicClerk` method that QUEUES the call in `premountMethodCalls`
 * during the bootstrap and **resolves having revoked nothing**. Callers must pass the load-safe one — but
 * `clerkLoaded` is an undocumented Clerk internal, so this command does not RELY on it: after the sign-out
 * resolves, the client must be loaded and hold no session, or the command throws. That assertion fails
 * CLOSED on any silent no-op, today's premount queue or a future regression in Clerk's wrapper alike, and
 * unlike a "did we call the right function" check it is an assertion about the actual security property.
 *
 * **Why `status === 'error'` short-circuits.** Clerk's load awaiter settles only on `ready`/`degraded`; on
 * `error` it never settles, so delegating would leave the caller's busy state spinning forever (B17). It
 * throws instead, which callers surface as a retryable failure.
 */

/** The identity client's bootstrap status, as both platform SDKs report it (`ClerkStatus`). */
export type SignOutClientStatus = 'degraded' | 'error' | 'loading' | 'ready';

/**
 * The (structural) slice of the identity client this command reads. Deliberately minimal: it is satisfied
 * by `useClerk()` on either platform without either platform's SDK being imported here.
 */
export interface SignOutVerificationClient {
    /** The client's bootstrap status. */
    readonly status: SignOutClientStatus;
    /** Whether the client SDK has finished loading (`false` for the whole bootstrap window). */
    readonly loaded: boolean;
    /** The active session, if any. `undefined` before the SDK is attached, `null` once signed out. */
    readonly session: { readonly id: string } | null | undefined;
}

/**
 * A sign-out that could not be PROVEN to have ended the session — either because the client failed to
 * load, or because it resolved while a session was still live. Never surfaced raw to a viewer; callers
 * translate it into their own localized copy.
 */
export class SignOutNotVerifiedError extends Error {
    public constructor(message: string) {
        super(message);
        this.name = 'SignOutNotVerifiedError';
        Object.setPrototypeOf(this, SignOutNotVerifiedError.prototype);
    }
}

/** Type guard for {@link SignOutNotVerifiedError}. */
export function isSignOutNotVerifiedError(error: unknown): error is SignOutNotVerifiedError {
    return error instanceof SignOutNotVerifiedError;
}

/**
 * End the viewer's session through the caller's load-safe `signOut`, then PROVE it ended.
 *
 * @param client - The identity client, read for the post-condition (pass `useClerk()`).
 * @param signOut - The SDK's LOAD-SAFE sign-out (`useAuth().signOut`), never the raw client method.
 * @throws {SignOutNotVerifiedError} When the client failed to load, or when the sign-out resolved WITHOUT
 *   ending the session — so the caller reports a failure instead of telling the viewer they left.
 * @throws Whatever `signOut` rejects with, unchanged, so a transport failure is not disguised as a no-op.
 * @sideEffect Destroys the viewer's session at the identity provider.
 */
export async function signOutAndVerify(client: SignOutVerificationClient, signOut: () => Promise<void>): Promise<void> {
    // The awaiter behind a load-safe `signOut` never settles on "error"; fail fast rather than hang (B17).
    if (client.status === 'error') {
        throw new SignOutNotVerifiedError('cannot sign out: the identity client failed to load');
    }

    await signOut();

    // ⚠️ DELIBERATE — ADR-0009. Not defensive noise: a sign-out that resolved without revoking anything is
    // the observed defect, and without this the viewer is told they left while their session is still live.
    if (!client.loaded) {
        throw new SignOutNotVerifiedError(
            `sign-out did not take effect: the identity client is not loaded (status "${client.status}")`,
        );
    }

    if (client.session) {
        throw new SignOutNotVerifiedError(`sign-out did not take effect: session ${client.session.id} is still active`);
    }
}
