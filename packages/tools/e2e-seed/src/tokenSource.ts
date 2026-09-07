/**
 * A `TokenSource` that re-mints from a held Clerk session instead of signing in again.
 *
 * `RecipeServiceClient` already declares the seam — `TokenSource` is a Strategy, re-read per request, and
 * the client calls back with `{ forceRefresh: true }` when it retries an expired-token `401`. So this is a
 * DECORATOR over `remintFromSession`: identical interface, one orthogonal concern (caching), errors
 * propagated unaltered. Nothing here invents a credential abstraction the client does not already have.
 *
 * ⚠️ The TTL is short by design. A Clerk session token lives about a minute; caching for close to that
 * would hand the client a token that expires mid-request, which surfaces as a `401` the client then retries
 * anyway. Re-minting a few seconds early is cheaper than the retry it avoids.
 */
import type { SessionHandle, SessionCredential } from '@kitchensink/e2e-fixtures';

/** How long a minted token is reused before this re-mints. Well under Clerk's own ~60s lifetime. */
export const TOKEN_TTL_MS = 45_000;

/** Whether a token minted at `issuedAtMs` is still worth reusing. Pure. */
export function shouldRemint(issuedAtMs: number | undefined, nowMs: number, ttlMs: number): boolean {
    return issuedAtMs === undefined || nowMs - issuedAtMs >= ttlMs;
}

/** The pieces this needs from the world, injected so a unit test never touches Clerk. */
export interface TokenSourceDeps {
    readonly remint: (handle: SessionHandle) => Promise<SessionCredential>;
    readonly now?: () => number;
    readonly ttlMs?: number;
}

/**
 * A per-request token callback over one session.
 *
 * @sideEffect The returned callback mints against Clerk when its cached token has aged out.
 */
export function memoizingTokenSource(
    handle: SessionHandle,
    deps: TokenSourceDeps,
): (options?: { readonly forceRefresh?: boolean }) => Promise<string> {
    const now = deps.now ?? Date.now;
    const ttlMs = deps.ttlMs ?? TOKEN_TTL_MS;

    let cached: string | undefined;
    let issuedAtMs: number | undefined;

    return async (options) => {
        // `forceRefresh` is the client telling us the cached token was REFUSED. Honouring the cache there
        // would hand back the very token that just failed and turn a recoverable 401 into a retry loop.
        if (options?.forceRefresh === true || shouldRemint(issuedAtMs, now(), ttlMs)) {
            const credential = await deps.remint(handle);
            cached = credential.token;
            issuedAtMs = now();
        }

        if (cached === undefined) {
            throw new Error('token source produced no token');
        }

        return cached;
    };
}
