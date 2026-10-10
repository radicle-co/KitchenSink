/**
 * Which words a failed sign-in or sign-up call shows. One rule for both screens: say the service was unreachable only
 * when it was; otherwise show what Clerk said; otherwise the screen's own localized fallback. The raw `Error` of a
 * thrown failure is never shown unless it carries a message Clerk wrote.
 */
import { describe, expect, it } from 'vitest';

import { authFailureMessage } from '../../src/auth/authFailureMessage.js';

const copy = { networkError: 'NETWORK', fallback: 'FALLBACK' };

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
