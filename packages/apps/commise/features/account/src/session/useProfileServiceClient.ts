/**
 * @module session/useProfileServiceClient — the identity client every app hook is built by.
 *
 * The apps own what is platform-bound: the identity origin, whether a 401 redirects (web) or not (mobile), and the Clerk
 * token template (native tokens are `azp`-less). This hook owns the rest — the token policy ({@link tokenSourceFrom}:
 * no token means no request, `forceRefresh` reaches Clerk) and the memoization — so the two platforms cannot drift on
 * either, which is how web came to send empty bearers and skip the fresh-token replay.
 *
 * Pattern: **Factory** (the app injects `build`, the one construction site for its client) behind a **headless hook**.
 */
import type { TokenSource } from '@kitchensink/retry-after/bearer-replay';
import { useMemo } from 'react';

import type { ProfileServiceClient } from '../profileServiceClient.js';
import { tokenSourceFrom, type ClerkGetToken } from './tokenSourceFrom.js';

/** What an app supplies to get its identity client. */
export interface ProfileServiceClientInput {
    /** The session's load-safe `getToken` (`useAuth().getToken` on either platform). */
    readonly getToken: ClerkGetToken;
    /** Builds the app's client around the token source. A stable (module-level) function. */
    readonly build: (token: TokenSource) => ProfileServiceClient;
    /** The Clerk JWT template to mint from, when the platform needs one. */
    readonly template?: string;
}

/**
 * The identity client for the signed-in session, rebuilt only when the session's `getToken` changes.
 *
 * @param input - The session, the app's builder and the optional token template.
 * @returns The memoized client.
 */
export function useProfileServiceClient({
    getToken,
    build,
    template,
}: ProfileServiceClientInput): ProfileServiceClient {
    return useMemo(() => build(tokenSourceFrom(getToken, template)), [getToken, build, template]);
}
