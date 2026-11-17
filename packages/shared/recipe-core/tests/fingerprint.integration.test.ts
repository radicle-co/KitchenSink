/**
 * The fingerprint against the PRODUCTION keyed hash (`keyedShingleHash`: HMAC-SHA256, first 8 bytes as a signed
 * int64), driven by a keyring parsed from its secret. The unit tier proves the maths through a stand-in; this tier
 * proves the services' hasher satisfies the injected `KeyedHash` contract end to end.
 */
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { contentDigestInput } from '@kitchensink/recipe-core/step-writing/content-digest';
import { parseFingerprintKeyring } from '@kitchensink/recipe-core/step-writing/fingerprint-keyring';
import { keyedShingleHash } from '@kitchensink/recipe-core/step-writing/node-keyed-hash';
import {
    containment,
    fingerprint,
    isFingerprintMismatchError,
    jaccard,
    type Fingerprint,
} from '@kitchensink/recipe-core/step-writing/word-shingles';

const SECRET = JSON.stringify({ current: 2, k1: 'k'.repeat(32), k2: 'm'.repeat(32) });
const SOURCE = 'Cream the butter and sugar until pale. Beat in the eggs one at a time. Fold in the flour.';
const REWORD = 'Whisk butter with sugar to a pale cream, then add each egg in turn and fold through the flour.';

const ring = parseFingerprintKeyring(SECRET);

/** The fingerprint of `text` under key `version` of the ring, through the production hasher. */
function fingerprintUnder(text: string, version: number): Fingerprint {
    const key = ring.keys.get(version);

    if (key === undefined) {
        throw new Error(`the test keyring has no key ${version}`);
    }

    return fingerprint(text, 5, keyedShingleHash(key), version);
}

describe('fingerprint with the production keyed hasher', () => {
    it('round trips: the same text under the same key gives the same signed 64-bit set', () => {
        const a = fingerprintUnder(SOURCE, ring.current);
        const b = fingerprintUnder(SOURCE.toUpperCase(), ring.current);
        expect(b.hashes).toEqual(a.hashes);
        expect(a.hashes.size).toBeGreaterThan(0);

        for (const h of a.hashes) {
            expect(h).toBeGreaterThanOrEqual(-(2n ** 63n));
            expect(h).toBeLessThan(2n ** 63n);
        }
    });

    it('refuses to compare two key versions instead of scoring them as unrelated', () => {
        const current = fingerprintUnder(SOURCE, 2);
        const old = fingerprintUnder(SOURCE, 1);
        expect(old.hashes).not.toEqual(current.hashes);

        let caught: unknown;

        try {
            jaccard(current, old);
        } catch (error) {
            caught = error;
        }

        expect(isFingerprintMismatchError(caught)).toBe(true);
    });

    it('sees a copied sentence in the whole and misses a reworded one', () => {
        const source = fingerprintUnder(SOURCE, 2);
        const copied = fingerprintUnder('Beat in the eggs one at a time.', 2);
        const reworded = fingerprintUnder(REWORD, 2);
        expect(containment(copied, source)).toBe(1);
        expect(containment(reworded, source)).toBe(0);
        expect(jaccard(reworded, source)).toBe(0);
    });

    it('still sees a copied sentence with an invisible character hidden in it', () => {
        const source = fingerprintUnder(SOURCE, 2);
        expect(containment(fingerprintUnder('Beat in the e\u200Bggs one at a time.', 2), source)).toBe(1);
    });

    it('still sees a copied sentence written with a Cyrillic look-alike letter', () => {
        const source = fingerprintUnder(SOURCE, 2);
        expect(containment(fingerprintUnder('Beat in the \u0435ggs one at a time.', 2), source)).toBe(1);
    });
});

describe('the content digest with a real SHA-256', () => {
    const digestOf = (parts: Parameters<typeof contentDigestInput>[0]): string =>
        createHash('sha256').update(contentDigestInput(parts), 'utf8').digest('hex');

    const base = {
        steps: ['Boil the water.', 'Add the pasta.'],
        ingredientLines: ['200 g pasta', '1 tsp salt'],
        language: 'en',
    };

    it('is a 64-character lower-case hex digest with a known value, so the preimage cannot drift', () => {
        expect(digestOf(base)).toBe('f302cbf20d8aa0ce587f334178d8bfc719ffaf74ca9d43ceb79773c227cb9609');
    });

    it('is the same after edits that change no words: whitespace, empty lines, invisibles', () => {
        const noisy = {
            steps: ['  Boil\u200B  the water. ', '', 'Add the\tpasta.'],
            ingredientLines: ['200  g pasta', '1 tsp sa\u00ADlt'],
            language: 'en',
        };
        expect(digestOf(noisy)).toBe(digestOf(base));
    });

    it('changes when a word, the step order or the language changes', () => {
        const digests = new Set([
            digestOf(base),
            digestOf({ ...base, steps: ['Boil the milk.', 'Add the pasta.'] }),
            digestOf({ ...base, steps: [...base.steps].reverse() }),
            digestOf({ ...base, language: 'fr' }),
        ]);
        expect(digests.size).toBe(4);
    });
});
