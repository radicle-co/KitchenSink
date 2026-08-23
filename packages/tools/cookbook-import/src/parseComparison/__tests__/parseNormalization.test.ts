import { describe, expect, it } from 'vitest';

import { normalizeMeasure, normalizeName, normalizePrep, unitComparableWords } from '../parseNormalization.js';

describe('normalizeName', () => {
    it('folds case to a literal lower-case form', () => {
        expect(normalizeName('Brown Sugar')).toBe('brown sugar');
    });

    it('folds surrounding and interior whitespace to single spaces', () => {
        expect(normalizeName('  brown   sugar ')).toBe('brown sugar');
    });

    it('folds the plural, which is where the two parsers most often differ in spelling only', () => {
        expect(normalizeName('chicken livers')).toBe('chicken liver');
        expect(normalizeName('eggs')).toBe('egg');
        expect(normalizeName('peaches')).toBe('peach');
    });

    it('folds punctuation, so a trailing comma is not a disagreement', () => {
        expect(normalizeName('flour, wheat')).toBe('flour wheat');
        expect(normalizeName('baking-soda')).toBe('baking soda');
    });

    it('folds diacritics', () => {
        expect(normalizeName('purée')).toBe('puree');
    });

    it('keeps distinct foods distinct — folding must not manufacture agreement', () => {
        expect(normalizeName('sweet butter')).not.toBe(normalizeName('butter'));
        expect(normalizeName('brown sugar')).not.toBe(normalizeName('granulated sugar'));
    });

    it('yields the empty string for text with nothing in it', () => {
        expect(normalizeName('   ')).toBe('');
        expect(normalizeName('')).toBe('');
    });
});

describe('normalizeMeasure', () => {
    it('reads a number-word quantity and a numeral quantity to the same value', () => {
        expect(normalizeMeasure('one-half cup')).toEqual(normalizeMeasure('1/2 cups'));
    });

    it('separates the quantity from the unit', () => {
        expect(normalizeMeasure('two tablespoons')).toEqual({ quantity: '2', unit: 'tablespoon', residue: '' });
    });

    it('renders a fractional quantity as an exact rational, never a rounded decimal', () => {
        expect(normalizeMeasure('one-third cup').quantity).toBe('1/3');
    });

    it('reads a compound number word', () => {
        expect(normalizeMeasure('one and one-half cups').quantity).toBe('3/2');
    });

    it('drops the function words a measure phrase strands, which are grammar and never a unit', () => {
        expect(normalizeMeasure('three-fourths of a cup')).toEqual(normalizeMeasure('3/4 cups'));
    });

    it('reads the indefinite article as a count of one, the way the corpus uses it', () => {
        expect(normalizeMeasure('a saltspoon')).toEqual({ quantity: '1', unit: 'saltspoon', residue: '' });
    });

    it('reports an absent measure as absent rather than as an empty unit with a quantity', () => {
        expect(normalizeMeasure('')).toEqual({ quantity: null, unit: '', residue: '' });
        expect(normalizeMeasure('  ')).toEqual({ quantity: null, unit: '', residue: '' });
    });

    it('reports a bare count as a quantity with no unit', () => {
        expect(normalizeMeasure('3')).toEqual({ quantity: '3', unit: '', residue: '' });
    });

    describe('a hedge word in front of the quantity', () => {
        it('does not hide the quantity behind it', () => {
            expect(normalizeMeasure('about 2 cups')).toEqual(normalizeMeasure('2 cups'));
        });

        it('is dropped wherever it sits, so one parser echoing it is not a disagreement', () => {
            expect(normalizeMeasure('2 level tablespoons')).toEqual(normalizeMeasure('two tablespoons'));
            expect(normalizeMeasure('a scant cup')).toEqual(normalizeMeasure('one cup'));
        });
    });

    describe('a measure carrying more than one amount', () => {
        it('keeps the extra amount OUT of the unit, so a joined amount is not a unit difference', () => {
            expect(normalizeMeasure('2 cups 3 tablespoons')).toEqual({
                quantity: '2',
                unit: 'cup',
                residue: '3 tablespoon',
            });
        });

        it('reads the range tail into the residue rather than into the unit', () => {
            expect(normalizeMeasure('2 to 3 cups').unit).toBe(normalizeMeasure('two to three cups').unit);
            expect(normalizeMeasure('2 to 3 cups').quantity).toBe(normalizeMeasure('two to three cups').quantity);
        });

        it('agrees with itself across the two notations the two parsers use', () => {
            expect(normalizeMeasure('2 to 3 cups')).toEqual(normalizeMeasure('two to three cups'));
        });
    });

    it('keeps a unit the CRF does not know, so its loss is measurable rather than invisible', () => {
        expect(normalizeMeasure('one gill').unit).toBe('gill');
    });

    it('does not fold two different units together', () => {
        expect(normalizeMeasure('one cup').unit).not.toBe(normalizeMeasure('one pound').unit);
    });
});

describe('normalizePrep', () => {
    it('treats null and the empty string as the same absence', () => {
        expect(normalizePrep(null)).toBe('');
        expect(normalizePrep('')).toBe('');
        expect(normalizePrep('   ')).toBe('');
    });

    it('folds case, whitespace and plurals the same way a name is folded', () => {
        expect(normalizePrep('  Finely  Chopped ')).toBe(normalizePrep('finely chopped'));
    });

    it('keeps distinct preparations distinct', () => {
        expect(normalizePrep('minced')).not.toBe(normalizePrep('grated'));
    });
});

describe('unitComparableWords', () => {
    it("puts a name's words into the UNIT vocabulary, which the plain name fold does not speak", () => {
        // ⛔ The regression this function exists for: `normalizeUnit` canonicalises `teaspoonful` to
        // `teaspoon` while `rankingTokens` leaves it alone, so asking "is the model's unit inside the CRF's
        // name?" answered NO for exactly the spellings a 1900s cookbook uses.
        expect(unitComparableWords('teaspoonful of salt').has(normalizeMeasure('one teaspoonful').unit)).toBe(true);
        expect(unitComparableWords('saltspoonful of pepper').has(normalizeMeasure('a saltspoonful').unit)).toBe(true);
        expect(unitComparableWords('wineglassful of sherry').has(normalizeMeasure('one wineglassful').unit)).toBe(true);
    });

    it('still finds a unit that needs no alias rewrite', () => {
        expect(unitComparableWords('gill of milk').has(normalizeMeasure('one gill').unit)).toBe(true);
    });

    it('does not claim a unit that is simply absent from the name', () => {
        expect(unitComparableWords('milk').has(normalizeMeasure('one gill').unit)).toBe(false);
    });

    it('yields nothing for text with no words', () => {
        expect(unitComparableWords('   ').size).toBe(0);
    });
});
