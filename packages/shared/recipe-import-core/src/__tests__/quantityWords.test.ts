/**
 * MOD-019 / MOD-020 lexicon (FR-020, FR-021).
 *
 * | Requirement | Test |
 * | ----------- | ---- |
 * | FR-020 — quantity words must be readable from 1900s cookbook prose | every truth-table case below |
 * | FR-021 — duration/yield prose reuses the same lexicon             | multiplier + tens cases |
 *
 * These assert the LEXICON as data. The grammar that composes entries lives in `normalizeQuantity`
 * and is tested there; a test that only walked the map's own entries would prove nothing, so each
 * case here pins an EXPECTED VALUE written from the English word, not read back from the map.
 */
import { describe, it, expect } from 'vitest';

import {
    FRACTION_WORD_DENOMINATORS,
    INDEFINITE_QUALIFIERS,
    MULTIPLIER_WORDS,
    WHOLE_NUMBER_WORDS,
} from '../quantityWords.js';

describe('quantityWords', () => {
    describe('WHOLE_NUMBER_WORDS', () => {
        it.each([
            ['a', 1],
            ['an', 1],
            ['one', 1],
            ['two', 2],
            ['three', 3],
            ['four', 4],
            ['five', 5],
            ['six', 6],
            ['seven', 7],
            ['eight', 8],
            ['nine', 9],
            ['ten', 10],
            ['eleven', 11],
            ['twelve', 12],
            ['thirteen', 13],
            ['fourteen', 14],
            ['fifteen', 15],
            ['sixteen', 16],
            ['seventeen', 17],
            ['eighteen', 18],
            ['nineteen', 19],
            ['twenty', 20],
            ['thirty', 30],
            ['forty', 40],
            ['fifty', 50],
            ['sixty', 60],
        ])('maps %s to %i', (word, value) => {
            expect(WHOLE_NUMBER_WORDS.get(word)).toBe(value);
        });

        it('does not map an unknown word', () => {
            expect(WHOLE_NUMBER_WORDS.get('gazillion')).toBeUndefined();
        });

        it('is not vulnerable to prototype keys, because it is a Map and not an object literal', () => {
            expect(WHOLE_NUMBER_WORDS.get('__proto__')).toBeUndefined();
            expect(WHOLE_NUMBER_WORDS.get('constructor')).toBeUndefined();
        });

        it('holds exactly the closed vocabulary, so an accidental addition or deletion fails here', () => {
            expect(WHOLE_NUMBER_WORDS.size).toBe(29);
        });
    });

    describe('MULTIPLIER_WORDS', () => {
        it.each([
            ['dozen', 12],
            ['dozens', 12],
            ['hundred', 100],
        ])('maps %s to %i', (word, value) => {
            expect(MULTIPLIER_WORDS.get(word)).toBe(value);
        });

        it('keeps multipliers OUT of the whole-number table, because they multiply a preceding count', () => {
            expect(WHOLE_NUMBER_WORDS.get('dozen')).toBeUndefined();
            expect(WHOLE_NUMBER_WORDS.get('hundred')).toBeUndefined();
        });

        it('holds exactly the closed vocabulary', () => {
            expect(MULTIPLIER_WORDS.size).toBe(3);
        });
    });

    describe('FRACTION_WORD_DENOMINATORS', () => {
        it.each([
            ['half', 2],
            ['halves', 2],
            ['third', 3],
            ['thirds', 3],
            ['quarter', 4],
            ['quarters', 4],
            ['fourth', 4],
            ['fourths', 4],
            ['fifth', 5],
            ['fifths', 5],
            ['sixth', 6],
            ['sixths', 6],
            ['eighth', 8],
            ['eighths', 8],
            ['tenth', 10],
            ['tenths', 10],
            ['sixteenth', 16],
            ['sixteenths', 16],
        ])('maps %s to a denominator of %i', (word, denominator) => {
            expect(FRACTION_WORD_DENOMINATORS.get(word)).toBe(denominator);
        });

        it('never yields a zero denominator, which would make every derived rational undefined', () => {
            for (const denominator of FRACTION_WORD_DENOMINATORS.values()) {
                expect(denominator).toBeGreaterThan(0);
            }
        });

        it('holds exactly the closed vocabulary', () => {
            expect(FRACTION_WORD_DENOMINATORS.size).toBe(18);
        });
    });

    describe('INDEFINITE_QUALIFIERS', () => {
        it.each([['little'], ['few']])('treats %s as indefinite, so "a %s" is NOT a quantity of 1', (word) => {
            expect(INDEFINITE_QUALIFIERS.has(word)).toBe(true);
        });

        it('does not classify a real unit word as indefinite', () => {
            expect(INDEFINITE_QUALIFIERS.has('pinch')).toBe(false);
            expect(INDEFINITE_QUALIFIERS.has('sprig')).toBe(false);
            expect(INDEFINITE_QUALIFIERS.has('cup')).toBe(false);
        });

        it('holds exactly the qualifiers measured in the corpus, and nothing speculative', () => {
            expect(INDEFINITE_QUALIFIERS.size).toBe(2);
        });
    });
});
