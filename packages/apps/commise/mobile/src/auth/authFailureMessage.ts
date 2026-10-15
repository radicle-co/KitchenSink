/**
 * @module auth/authFailureMessage — the words a failed Clerk sign-in or sign-up call shows, one rule for both screens.
 *
 * An unreachable service is named as such (`buildSpec.md` §8 "States"); a missing or malformed EMAIL is said in our own
 * words, because Clerk's ("You have to use email address or username.", "Identifier is invalid.") name a username the
 * app does not offer; otherwise Clerk's own message is shown (it is the service's wording for "wrong password" or "too
 * many attempts"); otherwise the screen's localized fallback. A failure with no message never shows an empty alert.
 *
 * Pure.
 */
import { isClerkAPIResponseError } from '@clerk/expo';

import type { MobileMessages } from '../i18n/messages.js';

import { isNetworkFailure } from './networkFailure.js';

/** The localized copy the rule falls back on. */
export interface AuthFailureCopy {
    /** Said when Clerk could not be reached. */
    readonly networkError: string;
    /** Said when the email was left empty. */
    readonly emailRequired: string;
    /** Said when the email is not a valid address. */
    readonly emailInvalid: string;
    /** Said when the failure carries no words of its own. */
    readonly fallback: string;
}

/**
 * The shared words of the auth messages plus the screen's own fallback.
 *
 * @param auth - The `auth` block of the mobile messages.
 * @param fallback - What the screen says for a failure that carries no words of its own.
 * @returns The copy `authFailureMessage` draws on. Pure.
 */
export function authFailureCopy(auth: MobileMessages['auth'], fallback: string): AuthFailureCopy {
    return {
        networkError: auth.networkError,
        emailRequired: auth.emailRequired,
        emailInvalid: auth.emailInvalid,
        fallback,
    };
}

/** The form parameters that hold the email: sign-in sends it as `identifier`, sign-up as `email_address`. */
const EMAIL_PARAMS: ReadonlySet<string> = new Set(['identifier', 'email_address']);

/**
 * The email failure Clerk reported, if it reported one: the code is the API error's (`errors[0].code`), not the
 * wrapper's, and it is only an email failure when the parameter it names is the email.
 *
 * @returns Which of the two email messages applies, or `undefined`. Pure.
 */
function emailFailureOf(error: unknown): 'emailRequired' | 'emailInvalid' | undefined {
    // Clerk's guard THROWS for a non-object (a string or `undefined` is a legitimate failure here), so object first.
    if (typeof error !== 'object' || error === null || !isClerkAPIResponseError(error)) {
        return undefined;
    }

    const [first] = error.errors;

    if (first === undefined || first.meta.paramName === undefined || !EMAIL_PARAMS.has(first.meta.paramName)) {
        return undefined;
    }

    if (first.code === 'form_param_nil') {
        return 'emailRequired';
    }

    return first.code === 'form_param_format_invalid' || first.code === 'form_param_type_invalid'
        ? 'emailInvalid'
        : undefined;
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

    const emailFailure = emailFailureOf(error);

    if (emailFailure !== undefined) {
        return copy[emailFailure];
    }

    if (typeof error === 'string' && error !== '') {
        return error;
    }

    const message =
        typeof error === 'object' && error !== null ? (error as { readonly message?: unknown }).message : undefined;

    return typeof message === 'string' && message !== '' ? message : copy.fallback;
}
