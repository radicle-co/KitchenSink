/**
 * The portion normalizer (KTD-3, plan U8).
 *
 * The failure mode this guards is the same shape as the nutrient projection's: a WRONG gram weight is
 * silently wrong in every quantity derived from it, while a MISSING one is visibly unconvertible. So an
 * uninterpretable label must report absent, never a guess.
 */
import { describe, it, expect } from 'vitest';

import { normalizePortion, normalizePortions } from '../portionNormalization.js';

describe('normalizePortion', () => {
    it('turns a labelled amount into grams PER ONE unit', () => {
        expect(normalizePortion({ label: '1 cup chopped', gramWeight: 125 })).toEqual({
            unit: 'cup',
            gramsPerUnit: 125,
        });
    });

    it('divides by the amount — 2 tablespoons at 30 g is 15 g per tablespoon', () => {
        // The stored gramWeight is for the WHOLE label amount. Returning it unchanged would double every
        // conversion that referenced this portion.
        expect(normalizePortion({ label: '2 tablespoons', gramWeight: 30 })).toEqual({
            unit: 'tablespoon',
            gramsPerUnit: 15,
        });
    });

    it('parses an a/b fraction, which USDA labels use constantly', () => {
        // `Number('1/2')` is NaN, so a naive parse drops exactly the portions recipes reference most.
        expect(normalizePortion({ label: '1/2 cup', gramWeight: 60 })).toEqual({ unit: 'cup', gramsPerUnit: 120 });
    });

    it('folds plurals so `cups` and `cup` are one unit', () => {
        expect(normalizePortion({ label: '2 cups', gramWeight: 250 })?.unit).toBe('cup');
    });

    it('ignores trailing modifiers', () => {
        expect(normalizePortion({ label: '1 clove, minced', gramWeight: 3 })).toEqual({
            unit: 'clove',
            gramsPerUnit: 3,
        });
    });

    it('⛔ reports ABSENT rather than guessing, for every uninterpretable label', () => {
        expect(normalizePortion({ label: 'cup', gramWeight: 125 })).toBeNull();
        expect(normalizePortion({ label: 'a handful', gramWeight: 30 })).toBeNull();
        expect(normalizePortion({ label: '', gramWeight: 30 })).toBeNull();
    });

    it('reports ABSENT for a non-positive or zero-divisor amount', () => {
        expect(normalizePortion({ label: '0 cup', gramWeight: 125 })).toBeNull();
        expect(normalizePortion({ label: '-1 cup', gramWeight: 125 })).toBeNull();
        expect(normalizePortion({ label: '1/0 cup', gramWeight: 125 })).toBeNull();
    });

    it('reports ABSENT for a non-positive gram weight, never a zero or negative per-unit', () => {
        expect(normalizePortion({ label: '1 cup', gramWeight: 0 })).toBeNull();
        expect(normalizePortion({ label: '1 cup', gramWeight: -5 })).toBeNull();
    });
});

describe('normalizePortions', () => {
    it('de-duplicates by unit, first parseable wins', () => {
        const result = normalizePortions([
            { label: '1 cup', gramWeight: 125 },
            { label: '2 cups', gramWeight: 260 },
        ]);

        expect(result).toEqual([{ unit: 'cup', gramsPerUnit: 125 }]);
    });

    it('skips unparseable entries without dropping the parseable ones around them', () => {
        const result = normalizePortions([
            { label: 'a pinch', gramWeight: 1 },
            { label: '1 tablespoon', gramWeight: 15 },
        ]);

        expect(result).toEqual([{ unit: 'tablespoon', gramsPerUnit: 15 }]);
    });

    it('returns an empty list for a food with no usable portions', () => {
        expect(normalizePortions([])).toEqual([]);
        expect(normalizePortions([{ label: 'some', gramWeight: 5 }])).toEqual([]);
    });
});
