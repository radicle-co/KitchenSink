/**
 * The wording fingerprint: lower-cased, punctuation-stripped word shingles reduced to a versioned set of keyed
 * hashes. The hash is injected, so every test here reads what was hashed through an identity-style stand-in.
 */
import { describe, expect, it } from 'vitest';

import {
    containment,
    FINGERPRINT_FORMAT_VERSION,
    fingerprint,
    jaccard,
    wordShingles,
    type KeyedHash,
} from '../wordShingles.js';

/** A deterministic stand-in: a polynomial over the shingle's code units, shifted by a per-key salt. */
const hasherWithSalt =
    (salt: bigint): KeyedHash =>
    (shingle) =>
        [...shingle].reduce((acc, ch) => (acc * 131n + BigInt(ch.codePointAt(0) ?? 0)) % 2n ** 63n, salt);

const hash = hasherWithSalt(7n);

describe('wordShingles', () => {
    it('lower-cases and strips punctuation before cutting', () => {
        expect(wordShingles('Stir, then SIMMER; (gently) until thick.', 2)).toEqual([
            'stir then',
            'then simmer',
            'simmer gently',
            'gently until',
            'until thick',
        ]);
    });

    it('cuts 5-word windows with a stride of one', () => {
        expect(wordShingles('a b c d e f g', 5)).toEqual(['a b c d e', 'b c d e f', 'c d e f g']);
    });

    it('joins an apostrophe word instead of splitting it', () => {
        expect(wordShingles("don't stop", 2)).toEqual(['dont stop']);
    });

    it('gives a text shorter than the window one shingle of all its words, and empty text none', () => {
        expect(wordShingles('Whisk well', 5)).toEqual(['whisk well']);
        expect(wordShingles('  ,. ', 5)).toEqual([]);
    });

    it('reads composed and decomposed accents as the same word', () => {
        const composed = 'cr\u00e8me br\u00fbl\u00e9e';
        const decomposed = composed.normalize('NFD');
        expect(wordShingles(decomposed, 2)).toEqual(['cr\u00e8me br\u00fbl\u00e9e']);
        expect(wordShingles(decomposed, 2)).toEqual(wordShingles(composed, 2));
    });

    it('keeps a combining mark with no composed form inside its word', () => {
        expect(wordShingles('a\u0301\u0323 b', 2)).toHaveLength(1);
        expect(wordShingles('a\u0301\u0323 b c', 2)).toEqual([`${'a\u0301\u0323'.normalize('NFKC')} b`, 'b c']);
    });

    it.each([
        ['a soft hyphen', 'beat in the eg\u00ADgs'],
        ['a zero-width space', 'beat in the eg\u200Bgs'],
        ['a byte order mark', 'beat in the eg\uFEFFgs'],
    ])('does not let %s split a word', (_name, text) => {
        expect(wordShingles(text, 5)).toEqual(wordShingles('beat in the eggs', 5));
    });

    it('treats any whitespace run as one gap', () => {
        expect(wordShingles('a\n\n b\t c', 2)).toEqual(['a b', 'b c']);
    });
});

describe('fingerprint', () => {
    it('pins the format version at 1', () => {
        expect(FINGERPRINT_FORMAT_VERSION).toBe(1);
        expect(fingerprint('a b c', 2, hash).formatVersion).toBe(1);
    });

    it('gives the same set for the same text, regardless of case and punctuation', () => {
        const a = fingerprint('Mix the flour and water.', 2, hash);
        const b = fingerprint('mix the FLOUR, and water', 2, hash);
        expect(b.hashes).toEqual(a.hashes);
    });

    it('changes the set when the words are in a different order', () => {
        const forward = fingerprint('a b c d e f', 5, hash);
        const backward = fingerprint('f e d c b a', 5, hash);
        expect(jaccard(forward, backward)).toBe(0);
    });

    it('collapses a repeated shingle to one member', () => {
        expect(fingerprint('a b a b a b', 2, hash).hashes.size).toBe(2);
    });

    it('changes the set when one word changes', () => {
        const a = fingerprint('mix the flour and the water', 2, hash);
        const b = fingerprint('mix the sugar and the water', 2, hash);
        expect(b.hashes).not.toEqual(a.hashes);
        expect(jaccard(a, b)).toBeLessThan(1);
        expect(jaccard(a, b)).toBeGreaterThan(0);
    });

    it('gives a different set under a different key', () => {
        const a = fingerprint('mix the flour and water', 2, hasherWithSalt(1n));
        const b = fingerprint('mix the flour and water', 2, hasherWithSalt(2n));
        expect(jaccard(a, b)).toBe(0);
    });

    it('hashes the lower-cased, joined shingle and nothing else', () => {
        const seen: string[] = [];
        fingerprint('Add Salt, then stir', 2, (s) => {
            seen.push(s);

            return 1n;
        });
        expect(seen).toEqual(['add salt', 'salt then', 'then stir']);
    });
});

describe('jaccard and containment', () => {
    const set = (...n: bigint[]) => ({ formatVersion: 1 as const, hashes: new Set(n) });

    it('measures overlap over the union for jaccard', () => {
        expect(jaccard(set(1n, 2n, 3n), set(2n, 3n, 4n))).toBe(2 / 4);
        expect(jaccard(set(1n, 2n), set(1n, 2n))).toBe(1);
        expect(jaccard(set(1n), set(2n))).toBe(0);
    });

    it('is symmetric for jaccard and returns 0 when both sets are empty', () => {
        expect(jaccard(set(1n, 2n), set(2n, 3n, 9n))).toBe(jaccard(set(2n, 3n, 9n), set(1n, 2n)));
        expect(jaccard(set(), set())).toBe(0);
    });

    it('measures overlap over the part for containment, so it differs from jaccard on an asymmetric pair', () => {
        const part = set(1n, 2n);
        const whole = set(1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n);
        expect(containment(part, whole)).toBe(1);
        expect(jaccard(part, whole)).toBe(2 / 8);
        expect(containment(whole, part)).toBe(2 / 8);
    });

    it('returns 0 for an empty part rather than dividing by zero', () => {
        expect(containment(set(), set(1n))).toBe(0);
    });
});
