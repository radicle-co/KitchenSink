/**
 * Unit tests for the shared unit normalization + gram conversion ({@link normalizeUnit}, {@link unitToGrams}).
 */
import { describe, it, expect } from 'vitest';

import { normalizeUnit, unitToGrams } from '../units.js';

describe('normalizeUnit', () => {
    it('maps aliases + abbreviations to a canonical unit', () => {
        expect(normalizeUnit('grams')).toBe('g');
        expect(normalizeUnit('Kg')).toBe('kg');
        expect(normalizeUnit('Tbsp.')).toBe('tablespoon');
        expect(normalizeUnit('tsp')).toBe('teaspoon');
        expect(normalizeUnit('Cups')).toBe('cup');
        expect(normalizeUnit('cloves')).toBe('clove');
        expect(normalizeUnit('lbs')).toBe('lb');
    });

    it('de-pluralizes an unknown unit but leaves a known singular alone', () => {
        expect(normalizeUnit('carrots')).toBe('carrot');
        expect(normalizeUnit('cup')).toBe('cup');
    });

    /**
     * R31 — the `*ful` family. A 1900s cookbook writes `teaspoonful` where a modern one writes `teaspoon`,
     * and the de-pluralization fallback above cannot reach it: `teaspoonful` has no trailing `s`, so it
     * normalized to ITSELF and matched no portion, silently costing the line its gram conversion.
     */
    describe('the *ful family (R31)', () => {
        it.each([
            ['teaspoonful', 'teaspoon'],
            ['teaspoonfuls', 'teaspoon'],
            ['Teaspoonful.', 'teaspoon'],
            ['tablespoonful', 'tablespoon'],
            ['tablespoonfuls', 'tablespoon'],
            ['cupful', 'cup'],
            ['cupfuls', 'cup'],
        ])('normalizes %j to %j', (raw, canonical) => {
            expect(normalizeUnit(raw)).toBe(canonical);
        });

        it('converts a *ful line to grams through the SAME portion table a modern unit uses (R31)', () => {
            const portions = [{ unit: 'teaspoon', gramsPerUnit: 6 }];

            expect(unitToGrams(1, 'teaspoonful', portions)).toBe(6);
            expect(unitToGrams(2, 'tablespoonfuls', [{ unit: 'tablespoon', gramsPerUnit: 8 }])).toBe(16);
        });

        it('leaves a word that merely ENDS in "ful" alone, because it is not a measure', () => {
            expect(normalizeUnit('handful')).toBe('handful');
            expect(normalizeUnit('careful')).toBe('careful');
        });
    });
});

describe('unitToGrams', () => {
    it('converts mass units by exact factor (ingredient-independent)', () => {
        expect(unitToGrams(200, 'g')).toBe(200);
        expect(unitToGrams(1, 'kg')).toBe(1000);
        expect(unitToGrams(1, 'oz')).toBeCloseTo(28.3495, 4);
    });

    it('converts a volumetric/count unit via a matching portion (grams-per-unit)', () => {
        const portions = [
            { unit: 'cup', gramsPerUnit: 125 },
            { unit: 'tablespoon', gramsPerUnit: 8 },
        ];

        expect(unitToGrams(2, 'cups', portions)).toBe(250); // alias 'cups' → 'cup' → 125 × 2
        expect(unitToGrams(3, 'Tbsp', portions)).toBe(24); // 'Tbsp' → 'tablespoon' → 8 × 3
    });

    it('returns null when the unit is neither a mass unit nor covered by a portion', () => {
        expect(unitToGrams(2, 'cup', [])).toBeNull();
        expect(unitToGrams(1, 'clove')).toBeNull();
    });
});
