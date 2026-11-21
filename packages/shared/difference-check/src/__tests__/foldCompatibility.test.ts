/**
 * Stage 1 of v1 (KTD-2, staff 2026-11-21): NFKC, then NFD, strip every mark, format character and default-ignorable
 * code point, then NFC, then lower case. The strip runs BEFORE the tokeniser, so a mark can never split a word.
 */
import { describe, expect, it } from 'vitest';

import { foldCompatibility } from '../normalise/foldCompatibility.js';

describe('foldCompatibility', () => {
    it('folds compatibility forms: full-width letters and ligatures read as plain letters (NFKC)', () => {
        expect(foldCompatibility('ｓｔｉｒ ﬁnely')).toBe('stir finely');
    });

    it('strips zero-width and other invisible characters, so they cannot split or disguise a word', () => {
        expect(foldCompatibility('o​n‌i‍o⁠n')).toBe('onion');
        expect(foldCompatibility('on­ion')).toBe('onion');
        expect(foldCompatibility('on\ufeffion')).toBe('onion');
        expect(foldCompatibility('on᠎ion')).toBe('onion');
        expect(foldCompatibility('on️ion')).toBe('onion');
    });

    it('strips a format character that is not default-ignorable (U+0600)', () => {
        expect(foldCompatibility('on؀ion')).toBe('onion');
    });

    it('lower cases', () => {
        expect(foldCompatibility('STIR The Pan')).toBe('stir the pan');
    });

    it('folds a combining mark with no precomposed form, so it cannot split a word', () => {
        expect(foldCompatibility('st̸ir')).toBe('stir');
    });

    it('reads an accented letter as its plain letter: the looser matching is pinned', () => {
        expect(foldCompatibility('sáuté the jalapeño')).toBe('saute the jalapeno');
        expect(foldCompatibility('sauté the jalapeño')).toBe('saute the jalapeno');
    });

    it('keeps a letter whose mark is part of a script: the consonants of a Devanagari line stay, its vowel signs go', () => {
        // The looser matching on a mark-dependent script is a v1 limit, pinned here so the gate cannot change quietly.
        expect(foldCompatibility('नमक')).toBe('नमक');
        expect(foldCompatibility('नमस्ते')).toBe('नमसत');
    });

    it('leaves plain text with no mark alone', () => {
        expect(foldCompatibility('whisk the eggs')).toBe('whisk the eggs');
    });
});

describe('foldCompatibility over every code point (qse P4-Q4)', () => {
    // A coverage sweep of 1.1 million code points, not a timing claim: the bound only keeps a loaded CI runner from failing it.
    it(
        'leaves no mark, format character or default-ignorable code point in its output, whatever goes in',
        { timeout: 30_000 },
        () => {
            const forbidden = /[\p{M}\p{Cf}\p{Default_Ignorable_Code_Point}]/u;
            const offenders: string[] = [];

            for (let codePoint = 0; codePoint <= 0x10ffff; codePoint += 1) {
                if (codePoint >= 0xd800 && codePoint <= 0xdfff) {
                    continue;
                }

                const character = String.fromCodePoint(codePoint);

                // Surrounded by letters, so a lone mark has something to attach to and the fold sees real text.
                if (forbidden.test(foldCompatibility(`a${character}b`))) {
                    offenders.push(`U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`);
                }
            }

            expect(offenders).toEqual([]);
        },
    );

    it('folds a dotted capital I to plain i: lower case cannot put a dot back', () => {
        expect(foldCompatibility('k\u0130tchen st\u0130r')).toBe('kitchen stir');
    });
});
