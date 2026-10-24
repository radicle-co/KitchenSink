/**
 * MOD-019 pre-normalizer stage (FR-020).
 *
 * | Requirement | Test |
 * | ----------- | ---- |
 * | FR-020 — a free-text ingredient line must yield a structured quantity | every "reads" case |
 * | FR-020 — a line that cannot be parsed is preserved, never fabricated  | "leaves the line alone" cases |
 *
 * Why this module exists at all: `parse-ingredient@2.2.0` was MEASURED on 2026-08-19 to return
 * `quantity: null` for every number-WORD form ("one tablespoon of butter", "two-thirds cup of flour"),
 * which is how the entire 1900s-cookbook corpus is written.
 *
 * MUTATION LENS: every case asserts BOTH the exact rational and the rewritten line, and the rewritten
 * line differs from the input in every positive case. A `normalizeQuantity` that returned its input
 * unchanged would fail all of them.
 */
import Fraction from 'fraction.js';
import { describe, it, expect } from 'vitest';

import { normalizeQuantity } from '../normalizeQuantity.js';

/** Renders the result's rational as `n/d` so a failure message shows the exact value, not `0.666…`. */
function exact(quantity: Fraction | null): string | null {
    return quantity === null ? null : `${quantity.s * quantity.n}/${quantity.d}`;
}

describe('normalizeQuantity', () => {
    describe('whole-number words', () => {
        it.each([
            ['one tablespoon of butter', '1/1', '1 tablespoon of butter'],
            ['two eggs', '2/1', '2 eggs'],
            ['three eggs', '3/1', '3 eggs'],
            ['twelve grated almonds', '12/1', '12 grated almonds'],
            ['twenty minutes', '20/1', '20 minutes'],
            ['forty-five minutes', '45/1', '45 minutes'],
            ['sixty whole peppers', '60/1', '60 whole peppers'],
        ])('reads %s', (input, expectedExact, expectedLine) => {
            const result = normalizeQuantity(input);
            expect(exact(result.quantity)).toBe(expectedExact);
            expect(result.line).toBe(expectedLine);
        });
    });

    describe('indefinite articles', () => {
        it.each([
            ['a pinch of salt', '1/1', '1 pinch of salt'],
            ['an ounce of olive oil', '1/1', '1 ounce of olive oil'],
            ['a sprig of thyme', '1/1', '1 sprig of thyme'],
            ['a dozen raisins', '12/1', '12 raisins'],
        ])('reads %s as a quantity of one', (input, expectedExact, expectedLine) => {
            const result = normalizeQuantity(input);
            expect(exact(result.quantity)).toBe(expectedExact);
            expect(result.line).toBe(expectedLine);
        });

        it.each([['a little water'], ['a little salt'], ['a few slices of lemon'], ['a few whole cloves']])(
            'refuses to read %s as a quantity of one, because the article qualifies an INDEFINITE amount',
            (input) => {
                const result = normalizeQuantity(input);
                expect(result.quantity).toBeNull();
                expect(result.line).toBe(input);
            },
        );
    });

    describe('fraction words', () => {
        it.each([
            ['half a cup of flour', '1/2', '1/2 cup of flour'],
            ['one-half teaspoon salt', '1/2', '1/2 teaspoon salt'],
            ['one half teaspoon salt', '1/2', '1/2 teaspoon salt'],
            ['two-thirds cup of flour', '2/3', '2/3 cup of flour'],
            ['two thirds cup of flour', '2/3', '2/3 cup of flour'],
            ['three-quarters cup of sugar', '3/4', '3/4 cup of sugar'],
            ['three quarters cup of sugar', '3/4', '3/4 cup of sugar'],
            ['one-fourth cup of butter', '1/4', '1/4 cup of butter'],
            ['three-fifths cup of milk', '3/5', '3/5 cup of milk'],
            ['five-sixths cup of stock', '5/6', '5/6 cup of stock'],
            ['one-eighth pound of butter', '1/8', '1/8 pound of butter'],
            ['three-tenths cup of cream', '3/10', '3/10 cup of cream'],
            ['one-sixteenth teaspoon of mace', '1/16', '1/16 teaspoon of mace'],
        ])('reads %s', (input, expectedExact, expectedLine) => {
            const result = normalizeQuantity(input);
            expect(exact(result.quantity)).toBe(expectedExact);
            expect(result.line).toBe(expectedLine);
        });

        it('keeps two-thirds EXACT rather than collapsing it to a float', () => {
            const { quantity } = normalizeQuantity('two-thirds cup of flour');

            // fraction.js v5 carries the numerator and denominator as BigInt, so the rational is held
            // exactly; only `valueOf()` crosses into floating point.
            expect(quantity?.n).toBe(2n);
            expect(quantity?.d).toBe(3n);
            expect(quantity?.valueOf()).toBe(2 / 3);
            expect(quantity?.mul(3).valueOf()).toBe(2);
        });
    });

    describe('mixed numbers', () => {
        it.each([
            ['one and one-half pounds of beef', '3/2', '1 1/2 pounds of beef'],
            ['one and one half pounds of beef', '3/2', '1 1/2 pounds of beef'],
            ['two and a half cups of water', '5/2', '2 1/2 cups of water'],
            ['one and a quarter cups of milk', '5/4', '1 1/4 cups of milk'],
            ['two and one-half scant cups of sifted flour', '5/2', '2 1/2 scant cups of sifted flour'],
            ['three and one-half cups of flour', '7/2', '3 1/2 cups of flour'],
            ['two and three-quarter pounds of sugar', '11/4', '2 3/4 pounds of sugar'],
        ])('reads %s', (input, expectedExact, expectedLine) => {
            const result = normalizeQuantity(input);
            expect(exact(result.quantity)).toBe(expectedExact);
            expect(result.line).toBe(expectedLine);
        });
    });

    describe('multipliers', () => {
        it.each([
            ['two dozen eggs', '24/1', '24 eggs'],
            ['one-half dozen cloves', '6/1', '6 cloves'],
            ['one hundred medium-sized cucumbers', '100/1', '100 medium-sized cucumbers'],
        ])('reads %s', (input, expectedExact, expectedLine) => {
            const result = normalizeQuantity(input);
            expect(exact(result.quantity)).toBe(expectedExact);
            expect(result.line).toBe(expectedLine);
        });
    });

    describe('totality — the input is returned unchanged when there is no leading quantity phrase', () => {
        it.each([
            [''],
            ['   '],
            ['Boil the sauce and pour over the fish.'],
            ['salt and pepper to taste'],
            ['For the sauce:'],
            ['flour'],
        ])('leaves %j alone', (input) => {
            const result = normalizeQuantity(input);
            expect(result.quantity).toBeNull();
            expect(result.line).toBe(input);
        });

        it('does not read a quantity word that appears LATER in the line', () => {
            const result = normalizeQuantity('flour, two cups');
            expect(result.quantity).toBeNull();
            expect(result.line).toBe('flour, two cups');
        });

        it('never throws on adversarial input', () => {
            const adversarial = ['one-', '-one', 'and one', 'one and', 'one and and', 'a a a', 'half half half'];

            for (const input of adversarial) {
                expect(() => normalizeQuantity(input)).not.toThrow();
            }
        });
    });

    describe('numerals', () => {
        it.each([
            ['3 eggs', '3/1', '3 eggs', '3'],
            ['1 1/2 cups of water', '3/2', '1 1/2 cups of water', '1 1/2'],
            ['2/3 cup flour', '2/3', '2/3 cup flour', '2/3'],
            ['1.5 hours', '3/2', '1.5 hours', '1.5'],
            ['15 to 20 minutes', '15/1', '15 to 20 minutes', '15'],
        ])(
            'reads %s WITHOUT rewriting the line, because the notation is already a numeral',
            (input, expectedExact, expectedLine, expectedPhrase) => {
                const result = normalizeQuantity(input);
                expect(exact(result.quantity)).toBe(expectedExact);
                expect(result.line).toBe(expectedLine);
                expect(result.phrase).toBe(expectedPhrase);
            },
        );

        it('does not glue a bare vulgar fraction onto a preceding digit', () => {
            // NFKD turns "1\u00bd" into "11/2" (= 5.5, not 1.5), so unicode vulgar fractions are
            // deliberately NOT read here. `parse-ingredient` reads them correctly downstream.
            const result = normalizeQuantity('1\u00bd cups flour');
            expect(result.quantity?.valueOf()).not.toBe(5.5);
        });
    });

    describe('the matched phrase and the remainder', () => {
        it('reports the source phrase it consumed and everything after it', () => {
            const result = normalizeQuantity('one and one-half pounds of beef');
            expect(result.phrase).toBe('one and one-half');
            expect(result.rest).toBe(' pounds of beef');
        });

        it('returns the whole input as the remainder when nothing matched, so a caller loop terminates', () => {
            const result = normalizeQuantity('salt to taste');
            expect(result.quantity).toBeNull();
            expect(result.phrase).toBe('');
            expect(result.rest).toBe('salt to taste');
        });

        it('lets a caller walk consecutive terms without re-implementing the grammar', () => {
            const first = normalizeQuantity('one hour thirty minutes');
            expect(first.quantity?.valueOf()).toBe(1);
            const second = normalizeQuantity(first.rest.replace(/^ hour/, ''));
            expect(second.quantity?.valueOf()).toBe(30);
        });
    });

    describe('case and whitespace', () => {
        it('reads a capitalised leading word, because a corpus sentence starts with one', () => {
            const result = normalizeQuantity('Two cups of chopped celery');
            expect(exact(result.quantity)).toBe('2/1');
            expect(result.line).toBe('2 cups of chopped celery');
        });

        it('drops the leading whitespace it consumed along with the matched phrase', () => {
            const result = normalizeQuantity('  two eggs');
            expect(exact(result.quantity)).toBe('2/1');
            expect(result.line).toBe('2 eggs');
        });
    });
});
