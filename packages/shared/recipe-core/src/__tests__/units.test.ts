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

    /**
     * R32 — the historical volume units. A period cookbook writes `wineglassful`, `gill`, `saltspoon` and
     * `dessertspoon`, and each of those has a DEFINED amount (its own book's table of weights and measures,
     * or the named external standard for a unit that book leaves undefined).
     *
     * Canonicalising the spelling is what makes the equivalence LOOKUPABLE at all: `wineglassful` has no
     * trailing `s`, so the de-pluralization fallback leaves it as itself and no equivalence table keyed on
     * `wineglass` can ever be reached. This is the same defect R31 fixed for `teaspoonful`, one book older.
     */
    describe('historical volume units (R32)', () => {
        it.each([
            ['gill', 'gill'],
            ['gills', 'gill'],
            ['Gills.', 'gill'],
            ['wineglass', 'wineglass'],
            ['wineglasses', 'wineglass'],
            ['wineglassful', 'wineglass'],
            ['wineglassfuls', 'wineglass'],
            ['wine-glass', 'wineglass'],
            ['wine-glassful', 'wineglass'],
            ['saltspoon', 'saltspoon'],
            ['saltspoons', 'saltspoon'],
            ['saltspoonful', 'saltspoon'],
            ['saltspoonfuls', 'saltspoon'],
            ['dessertspoon', 'dessertspoon'],
            ['dessertspoons', 'dessertspoon'],
            ['dessertspoonful', 'dessertspoon'],
            ['dessertspoonfuls', 'dessertspoon'],
            ['dessert-spoon', 'dessertspoon'],
        ])('normalizes %j to %j', (raw, canonical) => {
            expect(normalizeUnit(raw)).toBe(canonical);
        });

        /**
         * ⛔ The boundary the R31 comment drew, redrawn rather than erased. `wineglassful` names a defined
         * amount and is now in the table; `glassful` and `handful` still name NO defined amount, and adding
         * them would invent a quantity the source never stated (R40).
         */
        it('still leaves the *ful words that name no defined amount alone', () => {
            expect(normalizeUnit('glassful')).toBe('glassful');
            expect(normalizeUnit('handful')).toBe('handful');
            expect(normalizeUnit('spoonful')).toBe('spoonful');
        });

        /**
         * ⚠️ A historical unit has NO ingredient-independent gram weight, and none is invented here. The
         * importer restates it in a canonical unit the food catalog's household portions cover (see
         * `@kitchensink/cookbook-import`'s `unitEquivalence.ts`) BEFORE a gram conversion is attempted.
         */
        it('does not fabricate a gram weight for a historical unit', () => {
            expect(unitToGrams(1, 'gill', [{ unit: 'cup', gramsPerUnit: 240 }])).toBeNull();
            expect(unitToGrams(1, 'wineglassful', [{ unit: 'cup', gramsPerUnit: 240 }])).toBeNull();
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
