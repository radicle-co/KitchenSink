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
