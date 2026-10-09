/**
 * @module auth/authFailureMessage — the words a failed Clerk sign-in or sign-up call shows, one rule for both screens.
 *
 * An unreachable service is named as such (`buildSpec.md` §8 "States"); otherwise Clerk's own message is shown (it is
 * the service's wording for "wrong password" or "too many attempts"); otherwise the screen's localized fallback. A
 * failure with no message never shows an empty alert.
 *
 * Pure.
 */
import { isNetworkFailure } from './networkFailure.js';

/** The localized copy the rule falls back on. */
export interface AuthFailureCopy {
    /** Said when Clerk could not be reached. */
    readonly networkError: string;
    /** Said when the failure carries no words of its own. */
    readonly fallback: string;
}

/**
 * @param error - What the Clerk call threw, or returned in its `error` field.
 * @param copy - The screen's localized words.
 * @returns The one line to show. Pure.
 */
export function authFailureMessage(error: unknown, copy: AuthFailureCopy): string {
    if (isNetworkFailure(error)) {
        return copy.networkError;
    }

    if (typeof error === 'string' && error !== '') {
        return error;
    }

    const message =
        typeof error === 'object' && error !== null ? (error as { readonly message?: unknown }).message : undefined;

    return typeof message === 'string' && message !== '' ? message : copy.fallback;
}
