/**
 * The classifier behind the sign-in screens' network alert (`buildSpec.md` §8 "States"). Cases are the shapes Clerk
 * and React Native really produce, taken from the shipped clerk-js native bundle: a `ClerkRuntimeError` carrying
 * `code: 'network_error'` (thrown, or returned as a future-API `error`), a `ClerkOfflineError`, and the bare
 * `TypeError('Network request failed')` React Native's `fetch` rejects with.
 *
 * The NEGATIVE rows carry as much weight as the positive ones: a classifier that answers `true` for everything would
 * tell a cook with a wrong password that the service is unreachable.
 */
import { describe, expect, it } from 'vitest';

import { isNetworkFailure } from '../../src/auth/networkFailure.js';

describe('isNetworkFailure', () => {
    it.each<[string, unknown]>([
        [
            'a Clerk runtime error with the network code',
            Object.assign(new Error('Browser is offline'), { code: 'network_error' }),
        ],
        ['a returned Clerk error object with the network code', { code: 'network_error', message: 'x' }],
        ['a Clerk offline error', Object.assign(new Error('offline'), { code: 'clerk_offline' })],
        ['React Native’s fetch rejection', new TypeError('Network request failed')],
        ['a browser fetch rejection', new TypeError('Failed to fetch')],
        ['a network error named in the message', new Error('NetworkError when attempting to fetch resource.')],
    ])('answers true for %s', (_name, error) => {
        expect(isNetworkFailure(error)).toBe(true);
    });

    it.each<[string, unknown]>([
        ['a rejected password', { code: 'form_password_incorrect', message: 'Incorrect password' }],
        ['a plain error', new Error('Something broke')],
        ['an error with no message', new Error()],
        [
            'a Clerk error with another code',
            Object.assign(new Error('Too many requests'), { code: 'too_many_requests' }),
        ],
        ['a string', 'Incorrect password'],
        ['null', null],
        ['undefined', undefined],
    ])('answers false for %s', (_name, error) => {
        expect(isNetworkFailure(error)).toBe(false);
    });
});
