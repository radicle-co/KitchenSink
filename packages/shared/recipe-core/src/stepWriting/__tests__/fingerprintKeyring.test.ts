/** The keyring secret: one JSON object holding every key version and which one is current. */
import { describe, expect, it } from 'vitest';

import { isFingerprintKeyringError, parseFingerprintKeyring } from '../fingerprintKeyring.js';

const K1 = 'a'.repeat(32);
const K2 = 'b'.repeat(32);

describe('parseFingerprintKeyring', () => {
    it('reads the current version and every key by number', () => {
        const ring = parseFingerprintKeyring(JSON.stringify({ current: 2, k1: K1, k2: K2 }));
        expect(ring.current).toBe(2);
        expect([...ring.keys]).toEqual([
            [1, K1],
            [2, K2],
        ]);
    });

    it('rejects a current version that has no key', () => {
        expect(() => parseFingerprintKeyring(JSON.stringify({ current: 2, k1: K1 }))).toThrow(/current key version 2/);
    });

    it.each([
        ['not json', '{nope'],
        ['not an object', '[1]'],
        ['no current', JSON.stringify({ k1: K1 })],
        ['current not a positive integer', JSON.stringify({ current: 0, k1: K1 })],
        ['current fractional', JSON.stringify({ current: 1.5, k1: K1 })],
        ['a key with a bad name', JSON.stringify({ current: 1, k1: K1, key2: K2 })],
        ['version zero', JSON.stringify({ current: 1, k1: K1, k0: K2 })],
        ['a key that is not a string', JSON.stringify({ current: 1, k1: 5 })],
        ['a key that is too short', JSON.stringify({ current: 1, k1: 'short' })],
        ['no keys', JSON.stringify({ current: 1 })],
        ['a key version above the smallint range', JSON.stringify({ current: 1, k1: K1, k32768: K2 })],
        ['a current version above the smallint range', JSON.stringify({ current: 32768, k32768: K1 })],
        ['a key version with a leading zero', JSON.stringify({ current: 1, k1: K1, k01: K2 })],
    ])('rejects %s with a typed error', (_name, json) => {
        let caught: unknown;

        try {
            parseFingerprintKeyring(json);
        } catch (error) {
            caught = error;
        }

        expect(isFingerprintKeyringError(caught)).toBe(true);
    });

    it('never puts a key value in the error message', () => {
        let message = '';

        try {
            parseFingerprintKeyring(JSON.stringify({ current: 3, k1: K1, k2: K2 }));
        } catch (error) {
            message = error instanceof Error ? error.message : '';
        }

        expect(message).not.toBe('');
        expect(message).not.toContain(K1);
        expect(message).not.toContain(K2);
    });

    it('keeps the largest allowed version as an exact integer, and never merges two long names into one', () => {
        const ring = parseFingerprintKeyring(JSON.stringify({ current: 32767, k32767: K1 }));
        expect([...ring.keys.keys()]).toEqual([32767]);
        expect(() =>
            parseFingerprintKeyring(JSON.stringify({ current: 1, k1: K1, k10000000000000000001: K2 })),
        ).toThrow();
    });

    it('keeps an old version readable after rotation', () => {
        const ring = parseFingerprintKeyring(JSON.stringify({ current: 2, k1: K1, k2: K2 }));
        expect(ring.keys.get(1)).toBe(K1);
    });
});
