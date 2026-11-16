import { describe, expect, it } from 'vitest';

import { matchStep, matchStepStrict, normalizeStepText, stepDigest } from '../stepDigest.js';

/** The hash part of a digest: `s1:` then 8 hex chars. */
const hashOf = (text: string): string => stepDigest(text).slice(3);

describe('stepDigest', () => {
    // Published FNV-1a 32-bit reference vectors: https://datatracker.ietf.org/doc/html/draft-eastlake-fnv-17
    // (test suite of Fowler, Noll, Vo: "" -> 811c9dc5, "a" -> e40c292c, "foobar" -> bf9cf968).
    it.each([
        ['', '811c9dc5'],
        ['a', 'e40c292c'],
        ['foobar', 'bf9cf968'],
    ])('hashes %j to the published FNV-1a 32 vector %s', (text, vector) => {
        expect(hashOf(text)).toBe(vector);
    });

    it('hashes non-ASCII text over its UTF-8 bytes (mutant: UTF-16 code units)', () => {
        expect(stepDigest('Fold in \u00bd cup cr\u00e8me fra\u00eeche')).toBe('s1:ff2c3386');
    });

    it('is versioned and fixed width', () => {
        expect(stepDigest('Stir')).toMatch(/^s1:[0-9a-f]{8}$/);
    });

    it('hashes UTF-8 bytes, not UTF-16 units', () => {
        // The UTF-8 bytes of NFC "é" are c3 a9.
        expect(hashOf('é')).toBe(fnv1a32([0xc3, 0xa9]));
    });

    it('keeps the digest across a whitespace-only edit', () => {
        expect(stepDigest('  Stir   the\n\tsauce ')).toBe(stepDigest('Stir the sauce'));
    });

    it('changes the digest when a word or digit changes (case and digits count)', () => {
        expect(stepDigest('Add 2 cups')).not.toBe(stepDigest('Add 3 cups'));
        expect(stepDigest('Stir')).not.toBe(stepDigest('stir'));
    });

    it('gives NFC and NFD forms of the same text one digest', () => {
        expect(stepDigest('café')).toBe(stepDigest('café'));
    });

    it('normalizes by collapsing Unicode whitespace to one space and trimming', () => {
        expect(normalizeStepText(' a  b c ')).toBe('a b c');
    });
});

/** Reference FNV-1a 32 over bytes, written independently of the implementation. */
function fnv1a32(bytes: number[]): string {
    let h = 0x811c9dc5n;

    for (const b of bytes) {
        h ^= BigInt(b);
        h = (h * 0x01000193n) & 0xffffffffn;
    }

    return h.toString(16).padStart(8, '0');
}

const d = (...texts: string[]): string[] => texts.map(stepDigest);

describe('matchStep', () => {
    const steps = d('one', 'two', 'three', 'four');

    it('takes the one digest match even when the index moved', () => {
        expect(matchStep({ index: 0, digest: stepDigest('three') }, steps)).toBe(2);
    });

    it('falls back to the saved index when nothing matches (mutant: no clamp, or digest ignored)', () => {
        expect(matchStep({ index: 1, digest: stepDigest('gone') }, steps)).toBe(1);
        expect(matchStep({ index: 9, digest: stepDigest('gone') }, steps)).toBe(3);
    });

    it('falls back to the clamped saved index when two steps match', () => {
        const twins = d('same', 'x', 'same');

        expect(matchStep({ index: 1, digest: stepDigest('same') }, twins)).toBe(1);
        expect(matchStep({ index: 7, digest: stepDigest('same') }, twins)).toBe(2);
    });

    it('returns undefined with zero steps so the caller keeps its stored index', () => {
        expect(matchStep({ index: 3, digest: stepDigest('a') }, [])).toBeUndefined();
    });

    it('never matches case-folded text', () => {
        expect(matchStep({ index: 0, digest: stepDigest('ONE') }, steps)).toBe(0);
        expect(matchStep({ index: 2, digest: stepDigest('ONE') }, steps)).toBe(2);
    });
});

describe('matchStepStrict', () => {
    const steps = d('one', 'two', 'two');

    it('takes the single match', () => {
        expect(matchStepStrict({ index: 2, digest: stepDigest('one') }, steps)).toBe(0);
    });

    it('drops on none or on several (no index fallback)', () => {
        expect(matchStepStrict({ index: 1, digest: stepDigest('gone') }, steps)).toBeUndefined();
        expect(matchStepStrict({ index: 1, digest: stepDigest('two') }, steps)).toBeUndefined();
    });
});
