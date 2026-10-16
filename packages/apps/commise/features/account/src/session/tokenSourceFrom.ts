/**
 * @module session/tokenSourceFrom — the ONE rule both apps mint an identity bearer by.
 *
 * Clerk's `getToken` (the same shape in `@clerk/nextjs` and `@clerk/expo`) takes its OWN options object and may resolve
 * `null`, while the client's {@link TokenSource} promises a string and a `forceRefresh` flag. Bridging the two used to
 * be written at every call site, and web wrote it five different ways wrong: `async () => (await getToken()) ?? ''`
 * drops `forceRefresh` (so a refused bearer is never replayed with a fresh one, and a brand-new account whose identity
 * row is not written back yet cannot recover) and turns "no session token" into `Authorization: Bearer ` with no value.
 * Mobile had it right. This is mobile's rule, stated once.
 *
 * Pattern: **Adapter** — Clerk's `getToken` adapted to the client's platform-free `TokenSource`; it fails CLOSED (no
 * token means no request), like `RecipeAuthNotReadyError` does for the recipe client.
 */
import { UnauthorizedError } from '../errors.js';

/** The slice of Clerk's `getToken` this adapter drives. Both Clerk SDKs' `getToken` satisfy it. */
export type ClerkGetToken = (options?: {
    readonly template?: string;
    readonly skipCache?: boolean;
}) => Promise<string | null | undefined>;

/**
 * Adapt a Clerk `getToken` to a {@link TokenSource}.
 *
 * @param getToken - The session's `getToken` (the load-safe one from `useAuth()`).
 * @param template - The Clerk JWT template to mint from, when the platform needs one (native tokens are `azp`-less).
 * @returns A token source that mints per request, forwards `forceRefresh` as `skipCache`, and never answers an empty token.
 * @throws {UnauthorizedError} (from the returned source) when the session yields no token, before any request is sent.
 * @sideEffect The returned source mints a token through Clerk.
 */
export function tokenSourceFrom(
    getToken: ClerkGetToken,
    template?: string,
): (options?: { readonly forceRefresh?: boolean }) => Promise<string> {
    return async (options) => {
        const token = await getToken({
            ...(template === undefined ? {} : { template }),
            skipCache: options?.forceRefresh ?? false,
        });

        if (!token) {
            throw new UnauthorizedError('Not authenticated', 'unauthenticated');
        }

        return token;
    };
}
