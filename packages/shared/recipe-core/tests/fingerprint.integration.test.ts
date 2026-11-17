/**
 * The fingerprint against a REAL keyed hasher: `node:crypto` HMAC-SHA256, first 8 bytes read as a signed bigint.
 * The unit tier proves the maths through a stand-in; this tier proves the injected `KeyedHash` contract holds for
 * a reference `node:crypto` HMAC adapter, and that a keyring parsed from its secret drives it.
 */
import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { parseFingerprintKeyring } from '../src/stepWriting/fingerprintKeyring.js';
import { containment, fingerprint, jaccard, type KeyedHash } from '../src/stepWriting/wordShingles.js';

const hmacHasher =
    (key: string): KeyedHash =>
    (shingle) =>
        createHmac('sha256', key).update(shingle).digest().readBigInt64BE(0);

const SECRET = JSON.stringify({ current: 2, k1: 'k'.repeat(32), k2: 'm'.repeat(32) });
const SOURCE = 'Cream the butter and sugar until pale. Beat in the eggs one at a time. Fold in the flour.';
const REWORD = 'Whisk butter with sugar to a pale cream, then add each egg in turn and fold through the flour.';

describe('fingerprint with a real HMAC-SHA256 hasher', () => {
    const ring = parseFingerprintKeyring(SECRET);
    const current = hmacHasher(ring.keys.get(ring.current) ?? '');

    it('round trips: the same text under the same key gives the same signed 64-bit set', () => {
        const a = fingerprint(SOURCE, 5, current);
        const b = fingerprint(SOURCE.toUpperCase(), 5, current);
        expect(b.hashes).toEqual(a.hashes);
        expect(a.hashes.size).toBeGreaterThan(0);

        for (const h of a.hashes) {
            expect(h).toBeGreaterThanOrEqual(-(2n ** 63n));
            expect(h).toBeLessThan(2n ** 63n);
        }
    });

    it('still sees a copied sentence with an invisible character hidden in it', () => {
        const source = fingerprint(SOURCE, 5, current);
        const disguised = fingerprint('Beat in the e\u200Bggs one at a time.', 5, current);
        expect(containment(disguised, source)).toBe(1);
    });

    it('shares nothing between two key versions', () => {
        const old = hmacHasher(ring.keys.get(1) ?? '');
        expect(jaccard(fingerprint(SOURCE, 5, current), fingerprint(SOURCE, 5, old))).toBe(0);
    });

    it('sees a copied sentence in the whole and misses a reworded one', () => {
        const source = fingerprint(SOURCE, 5, current);
        const copied = fingerprint('Beat in the eggs one at a time.', 5, current);
        const reworded = fingerprint(REWORD, 5, current);
        expect(containment(copied, source)).toBe(1);
        expect(containment(reworded, source)).toBe(0);
        expect(jaccard(reworded, source)).toBe(0);
    });
});
