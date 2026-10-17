/**
 * Token doubles for the `RecipeServiceClient` unit tests. The client sends a refused request again only with a bearer a
 * fresh mint made different (`@kitchensink/retry-after/bearer-replay`), so a test of a replay mints a new one per call.
 */
import { vi, type Mock } from 'vitest';

/** A token callback, as the client takes one. */
export type TokenCallback = (options?: { readonly forceRefresh?: boolean }) => string;

/**
 * A token callback that mints a new bearer on every call (`tok-1`, `tok-2`, …), as Clerk's `getToken` does when asked
 * to skip its cache.
 *
 * @returns The callback, recording each call's options.
 */
export function mintingToken(): Mock<TokenCallback> {
    let minted = 0;

    return vi.fn((_options?: { readonly forceRefresh?: boolean }) => {
        minted += 1;

        return `tok-${String(minted)}`;
    });
}

/**
 * The `forceRefresh` each call of a token double asked with, in order.
 *
 * @param token - The double.
 * @returns Each call's flag.
 */
export function forceRefreshFlagsOf(token: Mock<TokenCallback>): boolean[] {
    return token.mock.calls.map(([options]) => options?.forceRefresh === true);
}
