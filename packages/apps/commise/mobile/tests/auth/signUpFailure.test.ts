/**
 * Where a failed native sign-up says what went wrong (plan 012 D8, folding in plan 010 D13; WCAG 2.2 SC 3.3.1/3.3.3):
 * EVERY Clerk error is routed by the form parameter it names to THAT field — in our words for a missing value and for
 * an email that is not one, in Clerk's own words otherwise (a username that is taken or not allowed). An error on a
 * field the step does not show, or on no field, goes to the one alert above the button: a message is never dropped,
 * and a failure is never silent. Pure.
 */
import { ClerkAPIResponseError } from '@clerk/shared/error';
import { describe, expect, it, vi } from 'vitest';

import { signUpFailure, type SignUpErrorField } from '../../src/auth/signUpFailure.js';

vi.mock('@clerk/expo', async () => {
    const { isClerkAPIResponseError } = await import('@clerk/shared/error');

    return { isClerkAPIResponseError };
});

const copy = {
    networkError: 'NETWORK',
    fallback: 'FALLBACK',
    emailRequired: 'EMAIL REQUIRED',
    emailInvalid: 'EMAIL INVALID',
    required: {
        first_name: 'FIRST REQUIRED',
        last_name: 'LAST REQUIRED',
        username: 'USERNAME REQUIRED',
        email_address: 'EMAIL REQUIRED',
        password: 'PASSWORD REQUIRED',
    },
};

/** Every field the typed sign-up form shows. */
const TYPED_FORM: ReadonlySet<SignUpErrorField> = new Set([
    'first_name',
    'last_name',
    'username',
    'email_address',
    'password',
]);

/** Clerk's API answer: one error per entry, each naming the form parameter it is about. */
function apiErrors(...errors: readonly { code: string; param?: string; message?: string }[]) {
    return new ClerkAPIResponseError('Clerk failed', {
        data: errors.map(({ code, param, message = `Clerk says ${code}` }) => ({
            code,
            message,
            long_message: message,
            meta: param === undefined ? {} : { param_name: param },
        })),
        status: 422,
    });
}

describe('signUpFailure', () => {
    it('routes EVERY error to its field, not only the first', () => {
        const failure = signUpFailure(
            apiErrors(
                { code: 'form_identifier_exists', param: 'username', message: 'That username is taken.' },
                { code: 'form_param_nil', param: 'first_name' },
                { code: 'form_param_format_invalid', param: 'email_address' },
            ),
            TYPED_FORM,
            copy,
        );

        expect(failure).toEqual({
            fields: {
                username: 'That username is taken.',
                first_name: 'FIRST REQUIRED',
                email_address: 'EMAIL INVALID',
            },
        });
    });

    it('keeps Clerk’s own words for a username it does not allow, and for a password it rejects', () => {
        expect(
            signUpFailure(
                apiErrors(
                    { code: 'form_username_invalid_character', param: 'username', message: 'Not allowed.' },
                    { code: 'form_password_length_too_short', param: 'password', message: 'Too short.' },
                ),
                TYPED_FORM,
                copy,
            ),
        ).toEqual({ fields: { username: 'Not allowed.', password: 'Too short.' } });
    });

    it('says a missing password in our words, under the password', () => {
        expect(signUpFailure(apiErrors({ code: 'form_param_nil', param: 'password' }), TYPED_FORM, copy)).toEqual({
            fields: { password: 'PASSWORD REQUIRED' },
        });
    });

    it('⛔ sends an error on a field the step does NOT show to the alert, never dropping it', () => {
        const finishStep: ReadonlySet<SignUpErrorField> = new Set(['username']);

        expect(
            signUpFailure(
                apiErrors(
                    { code: 'form_identifier_exists', param: 'email_address', message: 'Address in use.' },
                    { code: 'form_identifier_exists', param: 'username', message: 'Taken.' },
                ),
                finishStep,
                copy,
            ),
        ).toEqual({ fields: { username: 'Taken.' }, form: 'Address in use.' });
    });

    it('sends an error no field owns to the form alert', () => {
        expect(
            signUpFailure(apiErrors({ code: 'too_many_requests', message: 'Slow down.' }), TYPED_FORM, copy),
        ).toEqual({ fields: {}, form: 'Slow down.' });
    });

    it('⛔ never answers an API error that lists no entries with silence', () => {
        expect(signUpFailure(apiErrors(), TYPED_FORM, copy)).toEqual({ fields: {}, form: 'FALLBACK' });
    });

    it('names an unreachable service in the form alert', () => {
        expect(signUpFailure(new TypeError('Network request failed'), TYPED_FORM, copy)).toEqual({
            fields: {},
            form: 'NETWORK',
        });
    });

    it('falls back to the screen’s own words for a failure that says nothing', () => {
        expect(signUpFailure({ message: '' }, TYPED_FORM, copy)).toEqual({ fields: {}, form: 'FALLBACK' });
    });
});
