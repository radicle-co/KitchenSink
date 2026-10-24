/**
 * The words a failed native Google / Apple sign-in shows, and whether Sentry hears of it (plan 012 D5a). A cancel says
 * nothing at all; a device that cannot run the provider says so in its own words; Clerk's answer (an account conflict,
 * too many attempts) is shown in Clerk's words; anything else is the fallback AND a Sentry report, because an
 * unexplained failure is the one a person cannot fix and the team cannot see otherwise.
 */
import { ClerkAPIResponseError } from '@clerk/shared/error';
import { describe, expect, it, vi } from 'vitest';

import { socialAuthFailure } from '../../src/auth/socialAuthFailure.js';

// `@clerk/expo` pulls in React Native, which a node test cannot load; its `isClerkAPIResponseError` IS the shared
// package's, so the real predicate stands in (`authFailureMessage` reads it).
vi.mock('@clerk/expo', async () => {
    const { isClerkAPIResponseError } = await import('@clerk/shared/error');

    return { isClerkAPIResponseError };
});

const copy = {
    networkError: 'NETWORK',
    emailRequired: 'EMAIL REQUIRED',
    emailInvalid: 'EMAIL INVALID',
    fallback: 'FALLBACK',
    googleUnavailable: 'GOOGLE UNAVAILABLE',
    appleUnavailable: 'APPLE UNAVAILABLE',
    socialFailed: 'FAILED WITH {provider}',
};

describe('socialAuthFailure', () => {
    it.each<[string, unknown]>([
        ['Google’s cancel', { code: 'SIGN_IN_CANCELLED', message: 'x' }],
        ['Apple’s cancel', { code: 'ERR_REQUEST_CANCELED', message: 'x' }],
    ])('is silent for %s — no message, no report', (_name, error) => {
        expect(socialAuthFailure('google', error, copy)).toEqual({ kind: 'silent' });
    });

    it('names an unreachable service for a network failure, and does not report it', () => {
        expect(socialAuthFailure('google', new TypeError('Network request failed'), copy)).toEqual({
            kind: 'message',
            message: 'NETWORK',
            report: false,
        });
    });

    it('says Google cannot run on this device for a Play services failure, and reports it (a misconfigured client looks the same)', () => {
        expect(
            socialAuthFailure(
                'google',
                { code: 'GOOGLE_SIGN_IN_ERROR', message: '[28444] Developer console is not set up correctly.' },
                copy,
            ),
        ).toEqual({ kind: 'message', message: 'GOOGLE UNAVAILABLE', report: true });
    });

    it.each(['ERR_REQUEST_FAILED', 'ERR_REQUEST_UNKNOWN', 'ERR_REQUEST_NOT_HANDLED', 'ERR_REQUEST_INVALID_RESPONSE'])(
        'says Sign in with Apple is not set up for Apple’s %s, and reports it',
        (code) => {
            expect(socialAuthFailure('apple', { code, message: 'x' }, copy)).toEqual({
                kind: 'message',
                message: 'APPLE UNAVAILABLE',
                report: true,
            });
        },
    );

    it('says Sign in with Apple is not set up when Clerk’s hook finds Apple unavailable on the device', () => {
        expect(
            socialAuthFailure('apple', new Error('Apple Authentication is not available on this device.'), copy),
        ).toEqual({ kind: 'message', message: 'APPLE UNAVAILABLE', report: true });
    });

    it('shows Clerk’s own words for a Clerk answer, and does not report it (the service said no, on purpose)', () => {
        const error = new ClerkAPIResponseError('Too many requests. Try again later.', {
            data: [{ code: 'too_many_requests', message: 'Too many requests. Try again later.' }],
            status: 429,
        });

        expect(socialAuthFailure('google', error, copy)).toEqual({
            kind: 'message',
            message: 'Too many requests. Try again later.',
            report: false,
        });
    });

    it.each<['apple' | 'google', string]>([
        ['google', 'FAILED WITH Google'],
        ['apple', 'FAILED WITH Apple'],
    ])('falls back to the %s sentence for anything else, and REPORTS it', (provider, message) => {
        expect(
            socialAuthFailure(provider, new Error('ClerkGoogleSignIn native module is not available.'), copy),
        ).toEqual({
            kind: 'message',
            message,
            report: true,
        });
    });
});
