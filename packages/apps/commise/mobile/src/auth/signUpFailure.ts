/**
 * @module auth/signUpFailure — where a failed native sign-up says what went wrong (plan 012 D8, folding in plan 010
 * D13), one rule for the typed sign-up form and the finish step after a Google / Apple sign-up.
 *
 * Clerk answers with one error per problem, each naming the form parameter it is about. EVERY one is routed to THAT
 * field when the step shows it (WCAG 2.2 SC 3.3.1): a missing value and an email that is not one in our words, anything
 * else — a username that is taken or not allowed, a password Clerk rejects — in Clerk's, which is the service's wording
 * for its own rules. An error on a field the step does not show, or on no field, goes to the one alert above the
 * button, as does a failure that is not a Clerk API answer (an unreachable service, through `authFailureMessage`, the
 * rule the sign-in screen shares). Nothing is dropped and nothing is silent.
 *
 * Pure.
 */
import { isClerkAPIResponseError } from '@clerk/expo';

import { authFailureMessage, type AuthFailureCopy } from './authFailureMessage.js';
import type { SignUpFieldName } from './signUpFields.js';

/** A field an error can sit under: a registry field, or the typed form's password. */
export type SignUpErrorField = SignUpFieldName | 'password';

/** The words the routing falls back on. */
export interface SignUpFailureCopy extends AuthFailureCopy {
    /** What each field says when it was left empty. */
    readonly required: Readonly<Record<SignUpErrorField, string>>;
}

/** Where each message goes. */
export interface SignUpFailure {
    /** One message per shown field Clerk named. */
    readonly fields: Partial<Record<SignUpErrorField, string>>;
    /** The one alert above the button, for what no shown field owns. */
    readonly form?: string;
}

/** The format codes that mean "this is not an email address". */
const FORMAT_CODES: ReadonlySet<string> = new Set(['form_param_format_invalid', 'form_param_type_invalid']);

/** The words one field shows for one Clerk error. Pure. */
function fieldMessage(field: SignUpErrorField, code: string, words: string, copy: SignUpFailureCopy): string {
    if (code === 'form_param_nil') {
        return copy.required[field];
    }

    if (field === 'email_address' && FORMAT_CODES.has(code)) {
        return copy.emailInvalid;
    }

    return words === '' ? copy.fallback : words;
}

/** The shown field an error names, or `undefined`. Pure. */
function shownFieldOf(param: string | undefined, shown: ReadonlySet<SignUpErrorField>): SignUpErrorField | undefined {
    return [...shown].find((field) => field === param);
}

/**
 * Route a failed `signUp.create` / `signUp.password` / `signUp.update`.
 *
 * @param error - What the Clerk call threw, or returned in its `error` field.
 * @param shown - The fields the step shows, so an error can sit under them.
 * @param copy - The screen's words.
 * @returns Each shown field's message, and the alert's — always at least one of them. Pure.
 */
export function signUpFailure(
    error: unknown,
    shown: ReadonlySet<SignUpErrorField>,
    copy: SignUpFailureCopy,
): SignUpFailure {
    // Clerk's guard THROWS for a non-object, so object first (see `authFailureMessage`).
    if (typeof error !== 'object' || error === null || !isClerkAPIResponseError(error)) {
        return { fields: {}, form: authFailureMessage(error, copy) };
    }

    const fields: Partial<Record<SignUpErrorField, string>> = {};
    let form: string | undefined;

    for (const entry of error.errors) {
        const field = shownFieldOf(entry.meta?.paramName, shown);
        const words = entry.longMessage ?? entry.message;

        if (field !== undefined) {
            fields[field] = fieldMessage(field, entry.code, words, copy);
        } else {
            form ??= words === '' ? copy.fallback : words;
        }
    }

    // An answer that lists no error at all still failed: say so rather than show nothing.
    if (form === undefined && Object.keys(fields).length === 0) {
        form = copy.fallback;
    }

    return form === undefined ? { fields } : { fields, form };
}
