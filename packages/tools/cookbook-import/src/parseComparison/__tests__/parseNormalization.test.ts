import { describe, expect, it } from 'vitest';

import {
    normalizeMeasure,
    normalizeName,
    normalizePrep,
    unitComparableWords,
    withStatedUnit,
} from '../parseNormalization.js';

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

    /**
     * U35 — capital `T` is a tablespoon, lowercase `t` is a teaspoon (owner ruling, 2026-08-25).
     *
     * ⛔ THIS FOLD DISCARDED THE CASE ONE LINE BEFORE THE LOOKUP, and that was harmless only for as long as
     * `normalizeUnit` discarded it too. Measured the moment the ruling landed and before this was fixed:
     * `normalizeMeasure('2 T sugar')` reported `teaspoon` — a CONFIDENT threefold understatement in the ONE
     * fold every agreement and determinism figure in the parse census is computed through. Before the
     * ruling the same phrase produced the unmatched token `'t'`; unmatched-becoming-silently-wrong is the
     * worst direction available, and it is precisely the "two folds" failure this module's own header
     * exists to prevent.
     *
     * `normalizeUnit` folds case itself, so splitting the word with its case intact changes nothing for any
     * other spelling — its fallback returns the FOLDED form, never the raw one, which the case-insensitive
     * cases below pin.
     */
    describe('U35 — the case-sensitive pair survives the measure fold', () => {
        it('reads a capital T as a tablespoon and a lowercase t as a teaspoon', () => {
            expect(normalizeMeasure('2 T sugar')).toEqual({ quantity: '2', unit: 'tablespoon', residue: 'sugar' });
            expect(normalizeMeasure('2 t sugar')).toEqual({ quantity: '2', unit: 'teaspoon', residue: 'sugar' });
        });

        it('keeps the two APART, so the census cannot score a threefold difference as agreement', () => {
            expect(normalizeMeasure('2 T sugar').unit).not.toBe(normalizeMeasure('2 t sugar').unit);
        });

        it('never reads a lowercase t as a tablespoon — the 3x error in the other direction', () => {
            expect(normalizeMeasure('2 t sugar').unit).not.toBe('tablespoon');
        });

        it('still folds case for every OTHER unit, so a mere spelling is not a difference', () => {
            expect(normalizeMeasure('2 Tbsp sugar').unit).toBe('tablespoon');
            expect(normalizeMeasure('2 TBSP sugar').unit).toBe('tablespoon');
            expect(normalizeMeasure('2 Cups flour').unit).toBe('cup');
            // The residue is a NAME, so it stays folded — a food is not case-sensitive.
            expect(normalizeMeasure('2 Cups FLOUR').residue).toBe('flour');
        });
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

    /**
     * U35 — a token whose case is ALREADY GONE cannot be canonicalised into a case-sensitive unit.
     *
     * ⛔ THIS IS THE OTHER HALF OF THE SAME DEFECT, and it does NOT have the same fix. `foldMeasureWords`
     * above still HAS the case and simply threw it away, so it stops. This function receives
     * `rankingTokens` output, and `foldForRanking` lower-cased it on the way to a rule the persisted match
     * grain mirrors in SQL — that fold cannot be undone, and asking for it here would bind a measurement
     * convenience to a one-way door.
     *
     * So for a spelling whose meaning DEPENDS on case, the honest answer is "undetermined", and the token is
     * left as it is rather than guessed at. Measured before this: `unitComparableWords('vitamin t
     * supplement')` yielded `teaspoon`, which is a real unit word manufactured out of a stray letter — and
     * this set exists to answer "did the CRF swallow the model's unit into the food name?", so a
     * manufactured unit is a manufactured YES.
     */
    it('U35 — leaves a case-dependent token alone rather than inventing a unit the case cannot support', () => {
        expect([...unitComparableWords('vitamin t supplement')]).toEqual(['vitamin', 't', 'supplement']);
        // Capital or lower, the token reaches here folded, so both must be left alone identically.
        expect([...unitComparableWords('T butter')]).toEqual(['t', 'butter']);
    });

    it('U35 — still canonicalises every spelling whose meaning does NOT depend on case', () => {
        expect(unitComparableWords('tbsp of butter').has('tablespoon')).toBe(true);
        expect(unitComparableWords('teaspoonful of salt').has('teaspoon')).toBe(true);
    });
});

/**
 * The fold for an arm that STATES its unit rather than leaving it to be derived (the bake-off's v3).
 *
 * ⛔ The claim under test is narrow and load-bearing: the stated unit REPLACES the derived one and leaves
 * the quantity and the residue exactly where `normalizeMeasure` put them. A fold that appended instead
 * manufactures a second amount out of a model that filled both slots consistently, and `judgeMeasure`
 * reports `amountCountDiffers` — a disagreement about nothing.
 */
describe('withStatedUnit', () => {
    it('replaces the derived unit and keeps the quantity', () => {
        const folded = withStatedUnit(normalizeMeasure('2'), 'cups');

        expect(folded).toEqual({ quantity: '2', unit: 'cup', residue: '' });
    });

    it('does not leave a consistently-restated unit behind as a second amount', () => {
        expect(withStatedUnit(normalizeMeasure('2 cups'), 'cups')).toEqual({
            quantity: '2',
            unit: 'cup',
            residue: '',
        });
    });

    it('keeps a genuine second amount in the residue', () => {
        expect(withStatedUnit(normalizeMeasure('2 cups 3 tablespoons'), 'cups')).toEqual({
            quantity: '2',
            unit: 'cup',
            residue: '3 tablespoon',
        });
    });

    it('canonicalises the stated unit through the same alias table every other unit goes through', () => {
        // ⚠️ The 1919 corpus spells these `*ful`. A raw comparison answered NO for exactly the historical
        // spellings this whole harness is made of.
        expect(withStatedUnit(normalizeMeasure('one'), 'teaspoonful').unit).toBe('teaspoon');
        expect(withStatedUnit(normalizeMeasure('one'), 'wineglassful').unit).toBe('wineglass');
    });

    it('records a stated absence as no unit, without falling back to the phrase', () => {
        // ⛔ The arm ANSWERED "this line states no unit". Re-deriving `cup` from the phrase would overwrite a
        // reading with our own, on exactly the lines where the two disagree.
        expect(withStatedUnit(normalizeMeasure('a cup'), '')).toEqual({ quantity: '1', unit: '', residue: '' });
        expect(withStatedUnit(normalizeMeasure('a cup'), '   ')).toEqual({ quantity: '1', unit: '', residue: '' });
    });

    it('reads the quantity out of a spelled-out measure the same way the derived fold does', () => {
        expect(withStatedUnit(normalizeMeasure('one and one-half'), 'cups')).toEqual({
            quantity: '3/2',
            unit: 'cup',
            residue: '',
        });
    });
});
