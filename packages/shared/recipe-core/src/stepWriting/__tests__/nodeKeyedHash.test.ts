/**
 * The production keyed hash: HMAC-SHA256 over the NFC shingle, first 8 bytes big-endian as a signed int64.
 *
 * The expected values below were computed OUTSIDE this code, with `openssl dgst -sha256 -hmac` and Python's
 * `hmac`, so they pin the byte order, the width and the sign: a copy that read little-endian or unsigned fails.
 */
import { describe, expect, it } from 'vitest';

import { isFingerprintKeyringError, parseFingerprintKeyring } from '../fingerprintKeyring.js';
import { hasherFor, keyedShingleHash } from '../nodeKeyedHash.js';

const KEY = 'k'.repeat(32);

describe('keyedShingleHash', () => {
    it.each([
        ['add salt', -8453062395423499775n],
        ['then stir', -4671151765253264264n],
        ['cream the butter and sugar', -4110609296325591999n],
    ])('hashes %j to the known signed int64', (shingle, expected) => {
        expect(keyedShingleHash(KEY)(shingle)).toBe(expected);
    });

    it('reads a string key as its UTF-8 bytes, the same as the bytes themselves', () => {
        expect(keyedShingleHash(new TextEncoder().encode(KEY))('add salt')).toBe(-8453062395423499775n);
    });

    it('hashes the NFC form, so composed and decomposed shingles agree', () => {
        const hash = keyedShingleHash(KEY);
        expect(hash('crème brûlée')).toBe(-5592258011558301833n);
        expect(hash('crème brûlée'.normalize('NFD'))).toBe(-5592258011558301833n);
    });

    it('gives a different value under a different key', () => {
        expect(keyedShingleHash('m'.repeat(32))('add salt')).not.toBe(-8453062395423499775n);
    });

    it('refuses an empty key rather than hashing under nothing', () => {
        expect(() => keyedShingleHash('')).toThrow(/key/);
        expect(() => keyedShingleHash(new Uint8Array())).toThrow(/key/);
    });
});

describe('hasherFor', () => {
    const ring = parseFingerprintKeyring(JSON.stringify({ current: 2, k1: 'k'.repeat(32), k2: 'm'.repeat(32) }));

    it('returns the key version together with the hash made from that version key', () => {
        const hasher = hasherFor(ring, 1);
        expect(hasher.keyVersion).toBe(1);
        expect(hasher.hash('add salt')).toBe(-8453062395423499775n);
        expect(hasherFor(ring, 2).keyVersion).toBe(2);
        expect(hasherFor(ring, 2).hash('add salt')).not.toBe(hasher.hash('add salt'));
    });

    it('throws a typed keyring error for a version the ring does not hold', () => {
        let caught: unknown;

        try {
            hasherFor(ring, 3);
        } catch (error) {
            caught = error;
        }

        expect(isFingerprintKeyringError(caught)).toBe(true);
    });
});
