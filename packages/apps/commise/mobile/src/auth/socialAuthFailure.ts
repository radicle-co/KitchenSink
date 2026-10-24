/**
 * @module auth/socialAuthFailure — the words a failed native Google / Apple sign-in shows, and whether Sentry hears of it
 * (plan 012 D5a).
 *
 * - a provider cancel → nothing at all;
 * - an unreachable network → `networkError`, unreported (it is the person's connection, not a defect);
 * - Google's `GOOGLE_SIGN_IN_ERROR` (`@clerk/expo` rethrows every Play-services status failure as it) →
 *   `googleUnavailable`, REPORTED — a missing or outdated Play services and a misconfigured Android client look the
 *   same from here, and only the report can tell the team which;
 * - Apple's `ERR_REQUEST_*`, or Clerk's "not available on this device" → `appleUnavailable`, reported;
 * - Clerk's own answer (an account conflict, too many attempts) → its words via {@link authFailureMessage},
 *   unreported (the service said no on purpose);
 * - anything else → `socialFailed` naming the provider, reported.
 *
 * @pattern Chain of Responsibility — the provider-specific links run first; Clerk's answer is handed to
 *     `authFailureMessage`, the one rule both auth screens already use.
 *
 * Pure.
 */
import { isClerkAPIResponseError } from '@clerk/shared/error';

import { authFailureMessage, type AuthFailureCopy } from './authFailureMessage.js';
import { isNetworkFailure } from './networkFailure.js';
import type { SocialProvider } from './socialAuthConfig.js';
import { isProviderCancel } from './socialSignInOutcome.js';

/** The localized copy the rule draws on. */
export interface SocialAuthFailureCopy extends AuthFailureCopy {
    /** Google's SDK could not run on this device (Play services missing or outdated). */
    readonly googleUnavailable: string;
    /** Sign in with Apple is not set up on this device. */
    readonly appleUnavailable: string;
    /** Anything else; contains `{provider}`. */
    readonly socialFailed: string;
}

/** What to do about a failure. */
export type SocialFailure =
    { readonly kind: 'silent' } | { readonly kind: 'message'; readonly message: string; readonly report: boolean };

/** The providers' brand names. They are names, not copy, so they are never translated. */
const PROVIDER_NAMES: Readonly<Record<SocialProvider, string>> = { apple: 'Apple', google: 'Google' };

function codeOf(error: unknown): string | undefined {
    if (typeof error !== 'object' || error === null || !('code' in error)) {
        return undefined;
    }

    const { code } = error as { readonly code: unknown };

    return typeof code === 'string' ? code : undefined;
}

function messageOf(error: unknown): string {
    if (typeof error !== 'object' || error === null || !('message' in error)) {
        return '';
    }

    const { message } = error as { readonly message: unknown };

    return typeof message === 'string' ? message : '';
}

function isAppleUnavailable(error: unknown): boolean {
    return (
        codeOf(error)?.startsWith('ERR_REQUEST_') === true || /not available on this device/iu.test(messageOf(error))
    );
}

/**
 * @param provider - The provider whose flow failed.
 * @param error - What the flow threw.
 * @param copy - The localized words.
 * @returns Silence, or the line to show and whether to report it. Pure.
 */
export function socialAuthFailure(
    provider: SocialProvider,
    error: unknown,
    copy: SocialAuthFailureCopy,
): SocialFailure {
    if (isProviderCancel(error)) {
        return { kind: 'silent' };
    }

    if (isNetworkFailure(error)) {
        return { kind: 'message', message: copy.networkError, report: false };
    }

    if (provider === 'google' && codeOf(error) === 'GOOGLE_SIGN_IN_ERROR') {
        return { kind: 'message', message: copy.googleUnavailable, report: true };
    }

    if (provider === 'apple' && isAppleUnavailable(error)) {
        return { kind: 'message', message: copy.appleUnavailable, report: true };
    }

    // Clerk's guard THROWS for a non-object, so object first.
    if (typeof error === 'object' && error !== null && isClerkAPIResponseError(error)) {
        return { kind: 'message', message: authFailureMessage(error, copy), report: false };
    }

    return {
        kind: 'message',
        message: copy.socialFailed.replace('{provider}', PROVIDER_NAMES[provider]),
        report: true,
    };
}
