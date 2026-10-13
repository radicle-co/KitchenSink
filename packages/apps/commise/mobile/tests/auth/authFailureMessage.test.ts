/**
 * Which words a failed sign-in or sign-up call shows. One rule for both screens: say the service was unreachable only
 * when it was; otherwise show what Clerk said; otherwise the screen's own localized fallback. The raw `Error` of a
 * thrown failure is never shown unless it carries a message Clerk wrote.
 */
import { ClerkAPIResponseError } from '@clerk/shared/error';
import { describe, expect, it, vi } from 'vitest';

import { authFailureMessage } from '../../src/auth/authFailureMessage.js';

// `@clerk/expo` pulls in React Native, which a node test cannot load; its `isClerkAPIResponseError` IS the shared
// package's, so the REAL predicate stands in and the fixtures below are REAL `ClerkAPIResponseError` instances.
vi.mock('@clerk/expo', async () => {
    const { isClerkAPIResponseError } = await import('@clerk/shared/error');

    return { isClerkAPIResponseError };
});

const copy = {
    networkError: 'NETWORK',
    fallback: 'FALLBACK',
    emailRequired: 'EMAIL REQUIRED',
    emailInvalid: 'EMAIL INVALID',
};

/** What Clerk's API answers with: one error `code`, naming the form parameter it is about. */
function apiError(code: string, paramName: string, message = `Clerk says ${code}`) {
    return new ClerkAPIResponseError(message, {
        data: [{ code, message, long_message: message, meta: { param_name: paramName } }],
        status: 422,
    });
}

describe('authFailureMessage', () => {
    it('names an unreachable service for a network failure, whatever message it carries', () => {
        expect(authFailureMessage({ code: 'network_error', message: 'Browser is offline' }, copy)).toBe('NETWORK');
        expect(authFailureMessage(new TypeError('Network request failed'), copy)).toBe('NETWORK');
    });

    it('shows Clerk’s own message otherwise', () => {
        expect(authFailureMessage({ code: 'form_password_incorrect', message: 'Incorrect password' }, copy)).toBe(
            'Incorrect password',
        );
        expect(authFailureMessage(new Error('Too many attempts'), copy)).toBe('Too many attempts');
    });

    describe('the two identifier failures Clerk words badly (A-004)', () => {
        it('says an email is needed when the identifier is missing', () => {
            expect(authFailureMessage(apiError('form_param_nil', 'identifier', 'You have to use email.'), copy)).toBe(
                'EMAIL REQUIRED',
            );
        });

        it.each(['form_param_format_invalid', 'form_param_type_invalid'])(
            'says the email is not valid for %s on the identifier',
            (code) => {
                expect(authFailureMessage(apiError(code, 'identifier', 'Identifier is invalid.'), copy)).toBe(
                    'EMAIL INVALID',
                );
            },
        );

        it('maps the same codes on an email_address parameter (sign-up)', () => {
            expect(authFailureMessage(apiError('form_param_nil', 'email_address'), copy)).toBe('EMAIL REQUIRED');
            expect(authFailureMessage(apiError('form_param_format_invalid', 'email_address'), copy)).toBe(
                'EMAIL INVALID',
            );
        });

        it('does NOT blame the email for the same code on another field', () => {
            expect(authFailureMessage(apiError('form_param_nil', 'password', 'Enter password.'), copy)).toBe(
                'Enter password.',
            );
        });

        it('passes any other Clerk code through with Clerk’s own words', () => {
            expect(
                authFailureMessage(apiError('form_password_incorrect', 'password', 'Incorrect password'), copy),
            ).toBe('Incorrect password');
        });
    });

    it('shows a string error as it is', () => {
        expect(authFailureMessage('Incorrect password', copy)).toBe('Incorrect password');
    });

    it.each<[string, unknown]>([
        ['an error with no message', new Error()],
        ['an object with a blank message', { message: '' }],
        ['an object with no message', {}],
        ['null', null],
        ['undefined', undefined],
    ])('falls back to the localized message for %s', (_name, error) => {
        expect(authFailureMessage(error, copy)).toBe('FALLBACK');
    });
});
