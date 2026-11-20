/**
 * The wording fingerprint: word shingles over the shared comparison form, reduced to a versioned set of keyed hashes.
 * The hash is injected, so every test here reads what was hashed through a deterministic stand-in.
 */
import { describe, expect, it } from 'vitest';

import {
    containment,
    FINGERPRINT_FORMAT_VERSION,
    fingerprint,
    isFingerprintMismatchError,
    jaccard,
    wordShingles,
    type KeyedHasher,
} from '../wordShingles.js';

/** A deterministic stand-in: a polynomial over the shingle's code units, shifted by a per-key salt. */
const hasherWithSalt = (salt: bigint, keyVersion = 1): KeyedHasher => ({
    keyVersion,
    hash: (shingle) =>
        [...shingle].reduce((acc, ch) => (acc * 131n + BigInt(ch.codePointAt(0) ?? 0)) % 2n ** 63n, salt),
});

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
        expect(wordShingles(decomposed, 2)).toHaveLength(1);
        expect(wordShingles(decomposed, 2)).toEqual(wordShingles(composed, 2));
    });

    it('keeps a combining mark with no composed form inside its word', () => {
        expect(wordShingles('a\u0301\u0323 b', 2)).toHaveLength(1);
        expect(wordShingles('a\u0301\u0323 b c', 2)).toEqual(['a b', 'b c']);
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
        expect(b.hashes).not.toEqual(a.hashes);
    });

    it('records the key version it was taken under', () => {
        expect(fingerprint('a b c', 2, hasherWithSalt(7n, 3)).keyVersion).toBe(3);
        expect(fingerprint('a b c', 2, hash).shingleSize).toBe(2);
        expect(fingerprint('a b c', 5, hash).shingleSize).toBe(5);
    });

    it.each([0, -1, 1.5, 32768, Number.NaN])('refuses key version %s', (version) => {
        expect(() => fingerprint('a b c', 2, hasherWithSalt(7n, version))).toThrow(/key version/);
    });

    it('hashes the lower-cased, joined shingle and nothing else', () => {
        const seen: string[] = [];
        fingerprint('Add Salt, then stir', 2, {
            keyVersion: 1,
            hash: (s) => {
                seen.push(s);

                return 1n;
            },
        });
        expect(seen).toEqual(['add salt', 'salt then', 'then stir']);
    });
});

describe('jaccard and containment', () => {
    const set = (...n: bigint[]) => ({ formatVersion: 1, keyVersion: 1, shingleSize: 5, hashes: new Set(n) });

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

describe('measures refuse fingerprints that cannot be compared', () => {
    const base = { formatVersion: 1, keyVersion: 1, shingleSize: 5, hashes: new Set([1n, 2n]) };

    const refusal = (run: () => unknown): unknown => {
        try {
            run();
        } catch (error) {
            return error;
        }

        return undefined;
    };

    it.each([
        ['key version', { ...base, keyVersion: 2 }],
        ['format version', { ...base, formatVersion: 2 }],
        ['shingle size', { ...base, shingleSize: 2 }],
    ])('throws a typed error on a %s mismatch, from both measures, instead of scoring 0', (_name, other) => {
        expect(isFingerprintMismatchError(refusal(() => jaccard(base, other)))).toBe(true);
        expect(isFingerprintMismatchError(refusal(() => containment(base, other)))).toBe(true);
        expect(isFingerprintMismatchError(refusal(() => containment(other, base)))).toBe(true);
    });

    it('refuses even when both sets are empty, because the versions still differ', () => {
        const empty = { ...base, hashes: new Set<bigint>() };
        expect(isFingerprintMismatchError(refusal(() => jaccard(empty, { ...empty, keyVersion: 2 })))).toBe(true);
    });

    it('compares fingerprints that agree on both versions', () => {
        expect(jaccard(base, { ...base })).toBe(1);
    });

    it('does not mistake other errors for a mismatch', () => {
        expect(isFingerprintMismatchError(new Error('x'))).toBe(false);
        expect(isFingerprintMismatchError(undefined)).toBe(false);
    });
});

describe('the persisted fold (fingerprint format 1)', () => {
    /**
     * Known answers for the whole text form: the shared comparison form, then every run of other punctuation as a
     * gap. The fold is part of what a stored fingerprint means, so any change to it must fail here and force a new
     * FINGERPRINT_FORMAT_VERSION. Look-alike letters are NOT folded: the input door for cook-typed public text must
     * refuse them.
     */
    it.each([
        ['Caf\u00E9 cr\u00E8me', ['cafe creme']],
        ['Stra\u00DFe', ['stra\u00DFe']],
        [
            '\u041F\u0440\u0438\u0432\u0435\u0442 \u043C\u0438\u0440',
            ['\u043F\u0440\u0438\u0432\u0435\u0442 \u043C\u0438\u0440'],
        ],
        ['\uFF25ggs \u2460', ['eggs 1']],
        ["Don\u00B4t stop, it's well-done", ['dont stop its well done']],
    ])('shingles %j as %j', (text, expected) => {
        expect(wordShingles(text, 5)).toEqual(expected);
    });

    it('does not fold a Cyrillic look-alike to Latin', () => {
        expect(wordShingles('beat in the \u0435ggs one at a time', 5)).not.toEqual(
            wordShingles('beat in the eggs one at a time', 5),
        );
    });

    it('still tells two different words apart', () => {
        expect(wordShingles('flour water', 2)).not.toEqual(wordShingles('sugar water', 2));
    });
});

describe('windows run across sentence and step boundaries', () => {
    it('cuts windows over the steps joined in order, so no sentence is a window of its own', () => {
        expect(wordShingles('Mix well. Add eggs. Stir now.', 5)).toEqual([
            'mix well add eggs stir',
            'well add eggs stir now',
        ]);
    });

    it('still trips the whole-recipe measure for a source copied as sentences of four words or fewer', () => {
        const steps = ['Mix the flour well.', 'Add two eggs now.', 'Stir until quite smooth.', 'Bake for an hour.'];
        const copy = ['mix the flour, well', 'ADD two eggs now', 'Stir until quite smooth', 'bake for an hour!'];
        const source = fingerprint(steps.join(' '), 5, hash);
        const copied = fingerprint(copy.join(' '), 5, hash);

        expect(jaccard(source, copied)).toBe(1);
        // Each step alone is under the window, so a per-sentence check has nothing to compare: it is skipped by name,
        // and this whole-recipe measure is the one that catches the copy.
        expect(steps.every((step) => wordShingles(step, 5).length === 1)).toBe(true);
    });
});
