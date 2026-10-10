/**
 * @module auth/networkFailure — whether a failed Clerk call failed because Clerk could not be REACHED (as opposed to
 * answering "no"), so the sign-in screens can say so (`docs/design/uiOverhaul/buildSpec.md` §8 "States").
 *
 * Library-first: Clerk ships `isNetworkError`, but it is marked `@internal` and `@clerk/shared` is not a dependency of
 * this app, so importing it would couple the screens to a private export of a transitive package. This is the same
 * three-way test over the shapes that actually occur, read from the shipped clerk-js native bundle: a
 * `ClerkRuntimeError` with `code: 'network_error'`, a `ClerkOfflineError` (`'clerk_offline'`), and the bare
 * `TypeError('Network request failed')` React Native's `fetch` rejects with.
 *
 * Pure.
 */

/** Clerk's codes for "could not reach the service". */
const NETWORK_CODES: ReadonlySet<string> = new Set(['network_error', 'clerk_offline']);

/** Message fragments (lower-cased, whitespace removed) React Native and browsers use for an unreachable network. */
const NETWORK_MESSAGES: readonly string[] = ['networkrequestfailed', 'networkerror', 'failedtofetch'];

/**
 * @param error - Whatever a Clerk call threw, or returned in its `error` field.
 * @returns True when the failure was a network failure. Pure.
 */
export function isNetworkFailure(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) {
        return false;
    }

    const { code, message } = error as { readonly code?: unknown; readonly message?: unknown };

    if (typeof code === 'string' && NETWORK_CODES.has(code)) {
        return true;
    }

    if (typeof message !== 'string') {
        return false;
    }

    const squashed = message.toLowerCase().replace(/\s+/g, '');

    return NETWORK_MESSAGES.some((fragment) => squashed.includes(fragment));
}
