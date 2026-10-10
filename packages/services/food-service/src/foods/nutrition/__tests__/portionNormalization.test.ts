/**
 * The portion normalizer (KTD-3, plan U8): a stored `{ label, gramWeight }` becomes `{ unit, gramsPerUnit }`.
 *
 * Two failure modes are guarded. A WRONG gram weight is silently wrong in every quantity derived from it, while a
 * MISSING one is visibly unconvertible, so a label the rule cannot read reports absent. And a unit the client
 * receives is the canonical one recipe-core's `normalizeUnit` produces (`oz`, never `onz`), so the recipe side's
 * `unitToGrams` matches it and a person can read it.
 *
 * The labels here are the shapes the pinned USDA files and the Branded extract hold (see `usdaPortionLabel`).
 */
import { describe, expect, it } from 'vitest';

import { normalizeUnit } from '@kitchensink/recipe-core';

import { normalizePortion, normalizePortions, type RawPortion } from '../portionNormalization.js';

describe('normalizePortion', () => {
    it.each<[string, number, string, number]>([
        ['1 cup, chopped', 91, 'cup', 91],
        ['4 oz', 113, 'oz', 28.25],
        ['2 tablespoons', 30, 'tablespoon', 15],
        ['1/2 cup', 60, 'cup', 120],
        ['1 1/2 tsp', 7.5, 'teaspoon', 5],
        ['½ cup', 60, 'cup', 120],
        ['0.25 cup', 30, 'cup', 120],
        ['1 ONZ', 28, 'oz', 28],
        ['8 OZA', 240, 'fluid ounce', 30],
        ['100 GRM', 100, 'g', 1],
        ['15 ML', 15, 'milliliter', 1],
        ['12 fl. oz.', 360, 'fluid ounce', 30],
        ['2 Tbsp', 30, 'tablespoon', 15],
        ['4 OZ | ABOUT', 113, 'oz', 28.25],
        ['1 large', 50, 'large', 50],
        ['1 medium (7" to 7-7/8" long)', 118, 'medium', 118],
        ['33 nuts', 33, 'nut', 1],
        ['1 thigh, bone and skin removed', 69, 'thigh', 69],
        ['1 cup drained', 226, 'cup', 226],
        ['1 tablespoon liquid oil', 11.9, 'tablespoon', 11.9],
        ['2 COOKIES', 30, 'cookie', 15],
        ['2 PIECES', 30, 'piece', 15],
    ])('reads %j at %d g as %j at %d g per unit', (label, gramWeight, unit, gramsPerUnit) => {
        expect(normalizePortion({ label, gramWeight })).toEqual({ unit, gramsPerUnit });
    });

    it.each<[string, string]>([
        ['1 egg white', 'a qualified count noun: the white of one egg is not one egg'],
        ['1 Banana Peel', 'a refuse weight, which is not the food'],
        ['1 extra large', 'a size of two words, which no recipe unit matches'],
        ['cup', 'no amount, so no per-unit weight'],
        ['Quantity not specified', 'no amount'],
        ['10159', 'an FNDDS portion code'],
        ['1 . oz', 'punctuation where the unit belongs'],
        ['2 , 1/2"" SLICES', 'no unit before the tail'],
        ['1-2 cups', 'a range, which states no one weight'],
        ['0 cup', 'a zero amount'],
        ['-1 cup', 'a negative amount, which `parse-ingredient` alone reads as one cup'],
        ['1,5 cup', 'a decimal comma, which `parse-ingredient` alone reads as fifteen'],
        ['about 1 cup', 'text before the amount'],
        ['1/0 cup', 'a zero denominator'],
        ['', 'nothing'],
        ['1 glass', 'a unit `normalizeUnit` does not keep fixed (`glas` becomes `gla`), so recipe can never match it'],
        ['1 RACC', 'FDA’s reference serving, which live Foundation records state and no cook measures by'],
    ])('reports %j absent: %s', (label) => {
        expect(normalizePortion({ label, gramWeight: 125 })).toBeNull();
    });

    it('reports a non-positive gram weight absent, never a zero or negative per-unit weight', () => {
        expect(normalizePortion({ label: '1 cup', gramWeight: 0 })).toBeNull();
        expect(normalizePortion({ label: '1 cup', gramWeight: -5 })).toBeNull();
    });

    it('emits only units that recipe-core keeps fixed, so the recipe side matches them', () => {
        for (const label of ['1 ONZ', '8 OZA', '100 GRM', '12 fl. oz.', '2 COOKIES', '1 large', '33 nuts', '2 Tbsp']) {
            const unit = normalizePortion({ label, gramWeight: 10 })?.unit;

            expect(unit).toBeDefined();
            expect(normalizeUnit(unit!)).toBe(unit);
        }
    });
});

describe('normalizePortions', () => {
    /**
     * Every ordering of the portions.
     *
     * @param portions - The portions.
     * @returns Each permutation.
     */
    function orderings(portions: readonly RawPortion[]): RawPortion[][] {
        if (portions.length <= 1) {
            return [[...portions]];
        }

        return portions.flatMap((first, index) =>
            orderings([...portions.slice(0, index), ...portions.slice(index + 1)]).map((rest) => [first, ...rest]),
        );
    }

    it.each<[string, RawPortion[], number]>([
        [
            'a label with no qualifier beats a qualified one',
            [
                { label: '1 cup, chopped', gramWeight: 160 },
                { label: '1 cup', gramWeight: 125 },
            ],
            125,
        ],
        [
            'then an amount of exactly one beats a scaled one',
            [
                { label: '0.5 cup', gramWeight: 60 },
                { label: '1 cup', gramWeight: 125 },
                { label: '2 cups', gramWeight: 260 },
            ],
            125,
        ],
        [
            'then the label that sorts first in code-point order',
            [
                { label: '1 cup, sliced', gramWeight: 115 },
                { label: '1 cup, chopped', gramWeight: 160 },
            ],
            160,
        ],
    ])('picks one weight per unit whatever the read order: %s', (_case, portions, gramsPerUnit) => {
        for (const ordering of orderings(portions)) {
            expect(normalizePortions(ordering)).toEqual([{ unit: 'cup', gramsPerUnit }]);
        }
    });

    it('treats two spellings of one unit as one unit', () => {
        expect(
            normalizePortions([
                { label: '1 tablespoon', gramWeight: 14 },
                { label: '1 Tbsp', gramWeight: 15 },
            ]),
        ).toEqual([{ unit: 'tablespoon', gramsPerUnit: 15 }]);
    });

    it('lists the units in code-point order, whatever the read order', () => {
        const portions = [
            { label: '1 tablespoon', gramWeight: 15 },
            { label: '1 large', gramWeight: 50 },
            { label: '1 cup', gramWeight: 240 },
        ];

        for (const ordering of orderings(portions)) {
            expect(normalizePortions(ordering).map((portion) => portion.unit)).toEqual(['cup', 'large', 'tablespoon']);
        }
    });

    it('skips a label it cannot read without dropping the ones around it', () => {
        expect(
            normalizePortions([
                { label: '1 egg white', gramWeight: 29 },
                { label: '1 tablespoon', gramWeight: 15 },
            ]),
        ).toEqual([{ unit: 'tablespoon', gramsPerUnit: 15 }]);
    });

    it('returns an empty list for a food with no usable portions', () => {
        expect(normalizePortions([])).toEqual([]);
        expect(normalizePortions([{ label: 'some', gramWeight: 5 }])).toEqual([]);
    });
});
