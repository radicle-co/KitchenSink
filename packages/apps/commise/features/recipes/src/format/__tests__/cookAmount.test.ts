/**
 * The amount a cook reads and the amount a screen reader says (UI Designer ruling Q5, 2026-11-06).
 *
 * | Rule | Test |
 * | ---- | ---- |
 * | 1. one fraction glyph joined to the whole, no space | "shows a cook's fraction" |
 * | 2. only ½ ⅓ ⅔ ¼ ¾ ⅛ ⅜ ⅝ ⅞, snapped within 0.01, else at most 2 decimals | "snaps within 0.01 and no further" |
 * | 3. g, kg, ml, l stay decimal; spoons, cups, oz, lb and counts use fractions | "keeps a metric amount decimal" |
 * | 4. en-* locales use fractions, every other locale a decimal with its own mark | "every other locale" |
 * | 5. the spoken form uses localized words, never the glyph | "speaks" |
 *
 * ⚠️ The mutation-sensitive cases sit on the boundary: 0.343 snaps to ⅓ (0.0097 away) and 0.344 does not (0.0107).
 */
import { describe, expect, it } from 'vitest';

import { recipeMessages } from '../../messages.js';
import { formatAmountNumber, speakAmounts } from '../cookAmount.js';

/** The shipped English words, so the spoken cases also pin the copy a screen reader hears. */
const WORDS = recipeMessages.en.amountWords;

describe('formatAmountNumber — a cook’s fraction (rules 1 and 2)', () => {
    it.each([
        [0.5, 'cup', '½'],
        [1 / 3, 'cup', '⅓'],
        [0.333, 'cup', '⅓'],
        [0.667, 'cup', '⅔'],
        [0.25, 'tsp', '¼'],
        [0.75, 'tsp', '¾'],
        [0.125, 'cup', '⅛'],
        [0.375, 'cup', '⅜'],
        [0.625, 'cup', '⅝'],
        [0.875, 'cup', '⅞'],
        [1.5, 'cups', '1½'],
        [2.75, 'tbsp', '2¾'],
        [3, 'cups', '3'],
    ] as const)('shows %d %s as %j', (value, unit, shown) => {
        expect(formatAmountNumber(value, 'en-US', unit)).toBe(shown);
    });

    it('snaps within 0.01 and no further', () => {
        expect(formatAmountNumber(0.343, 'en-US', 'cup')).toBe('⅓');
        expect(formatAmountNumber(0.344, 'en-US', 'cup')).toBe('0.34');
        expect(formatAmountNumber(0.3, 'en-US', 'cup')).toBe('0.3');
        expect(formatAmountNumber(0.2, 'en-US', 'cup')).toBe('0.2');
    });

    it('shows a value off the table as a decimal with at most 2 places and no trailing zeros', () => {
        expect(formatAmountNumber(1.234, 'en-US', 'cup')).toBe('1.23');
        expect(formatAmountNumber(1.1, 'en-US', 'cup')).toBe('1.1');
        expect(formatAmountNumber(2.4, 'en-US', undefined)).toBe('2.4');
    });

    it('rounds a value within 0.01 of a whole number to that whole number', () => {
        expect(formatAmountNumber(2.995, 'en-US', 'cup')).toBe('3');
        expect(formatAmountNumber(2.005, 'en-US', 'cup')).toBe('2');
    });

    it('treats an amount with no unit as a count, so it uses fractions', () => {
        expect(formatAmountNumber(1.5, 'en-US', undefined)).toBe('1½');
        expect(formatAmountNumber(0.5, 'en-US', '')).toBe('½');
        expect(formatAmountNumber(0.5, 'en-US', 'large')).toBe('½');
    });

    it('keeps the locale’s grouping for a whole number', () => {
        expect(formatAmountNumber(1000, 'en-US', 'g')).toBe('1,000');
        expect(formatAmountNumber(1000.5, 'en-US', 'cups')).toBe('1,000½');
    });
});

describe('formatAmountNumber — units (rule 3)', () => {
    it.each(['g', 'grams', 'kg', 'ml', 'mL', 'l', 'L', 'litres'])('keeps a metric amount decimal in %s', (unit) => {
        expect(formatAmountNumber(1.5, 'en-US', unit)).toBe('1.5');
        expect(formatAmountNumber(0.25, 'en-GB', unit)).toBe('0.25');
    });

    it.each(['cup', 'tbsp', 'teaspoons', 'oz', 'lb', 'pinch'])('uses fractions in %s', (unit) => {
        expect(formatAmountNumber(1.5, 'en-US', unit)).toBe('1½');
    });
});

describe('formatAmountNumber — locales (rule 4)', () => {
    it.each(['en', 'en-US', 'en-GB', 'en-AU'])('every en locale uses fractions (%s)', (locale) => {
        expect(formatAmountNumber(1.5, locale, 'cups')).toBe('1½');
    });

    it('every other locale uses a decimal with its own decimal mark', () => {
        expect(formatAmountNumber(1.5, 'de-DE', 'Tassen')).toBe('1,5');
        expect(formatAmountNumber(1 / 3, 'fr-FR', 'tasse')).toBe('0,33');
        expect(formatAmountNumber(1.5, 'es', undefined)).toBe('1,5');
    });
});

describe('speakAmounts — the spoken form (rule 5)', () => {
    it.each([
        ['½ cup', 'a half cup'],
        ['⅓ cup', 'a third cup'],
        ['¾ tsp', 'three quarters tsp'],
        ['1½ cups', '1 and a half cups'],
        ['2¾ tbsp', '2 and three quarters tbsp'],
        ['0.3 cups', '0.3 cups'],
        ['1.5 l', '1.5 l'],
        ['1½–2 cups', '1 and a half to 2 cups'],
        ['⅛–¼ tsp', 'an eighth to a quarter tsp'],
    ])('speaks %j as %j', (shown, spoken) => {
        expect(speakAmounts(shown, WORDS)).toBe(spoken);
    });

    it('speaks the no-break space between an amount and its unit as a plain space', () => {
        expect(speakAmounts('1½\u00A0cups unsalted butter', WORDS)).toBe('1 and a half cups unsalted butter');
    });

    it('never leaves a fraction glyph in the spoken text', () => {
        const glyphs = '½⅓⅔¼¾⅛⅜⅝⅞';

        for (const glyph of glyphs) {
            expect(speakAmounts(`3${glyph} cups`, WORDS)).not.toMatch(new RegExp(`[${glyphs}]`, 'u'));
        }
    });

    it('leaves a line with no fraction exactly as it was', () => {
        expect(speakAmounts('2–3 cups flour, sifted', WORDS)).toBe('2 to 3 cups flour, sifted');
        expect(speakAmounts('Edit 2 tbsp olive oil', WORDS)).toBe('Edit 2 tbsp olive oil');
    });
});
