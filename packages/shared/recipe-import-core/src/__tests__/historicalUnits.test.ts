/**
 * Unit tests for the historical-unit vocabulary and the per-system millilitre anchor (R32).
 *
 * The two halves are tested together because the whole point of the module is that they are SEPARATE:
 * this package knows the WORDS a period cookbook uses and the millilitre size of the units a standard
 * library already defines — and deliberately knows NO value for a historical unit, because that value is
 * a fact about one BOOK (`@kitchensink/cookbook-import`'s `unitEquivalence.ts`), not about the language.
 */
import { describe, it, expect } from 'vitest';
import { identifyUnit } from 'parse-ingredient';

import { HISTORICAL_UNIT_DEFINITIONS, millilitresPerUnit } from '../historicalUnits.js';
import { parseIngredientLine } from '../ingredientLine.js';

describe('millilitresPerUnit', () => {
    /**
     * ⛔ THE HEADLINE FACT OF R32/R33, and the reason a per-source resolution exists at all: the same word
     * names two different amounts. `4 gills = 1 pint` in BOTH tables, but the pints differ by 20%.
     */
    it('reads the SAME unit at a different size in each measure system', () => {
        expect(millilitresPerUnit('pint', 'us-customary')).toBeCloseTo(473.176, 2);
        expect(millilitresPerUnit('pint', 'british-imperial')).toBeCloseTo(568.261, 2);
    });

    it.each([
        ['cup', 'us-customary', 236.588],
        ['cup', 'british-imperial', 284.131],
        ['tablespoon', 'us-customary', 14.787],
        ['teaspoon', 'us-customary', 4.929],
        ['fluid ounce', 'us-customary', 29.574],
        ['fluid ounce', 'british-imperial', 28.413],
    ] as const)('reads %s in %s as ~%d mL', (unit, system, millilitres) => {
        expect(millilitresPerUnit(unit, system)).toBeCloseTo(millilitres, 2);
    });

    /**
     * ⛔ The load-bearing NEGATIVE. If this ever returns a number, the per-book equivalence table has been
     * bypassed and every book silently shares one set of factors — the exact failure R32 and R33 exist to
     * prevent. The historical units are declared here as SPELLINGS ONLY.
     */
    it.each(['gill', 'wineglass', 'saltspoon', 'dessertspoon'])(
        'refuses to size %s, because that is a fact about a BOOK and not about the language',
        (unit) => {
            expect(millilitresPerUnit(unit, 'us-customary')).toBeNull();
            expect(millilitresPerUnit(unit, 'british-imperial')).toBeNull();
        },
    );

    it('returns null for a word that is not a volume unit at all', () => {
        expect(millilitresPerUnit('carrot', 'us-customary')).toBeNull();
        expect(millilitresPerUnit('pound', 'us-customary')).toBeNull();
    });

    it('normalizes the spelling before looking the unit up', () => {
        expect(millilitresPerUnit('Cups', 'us-customary')).toBeCloseTo(236.588, 2);
        expect(millilitresPerUnit('tsp', 'us-customary')).toBeCloseTo(4.929, 2);
    });
});

describe('HISTORICAL_UNIT_DEFINITIONS', () => {
    it('declares every historical unit WITHOUT a conversion factor', () => {
        for (const [id, definition] of Object.entries(HISTORICAL_UNIT_DEFINITIONS)) {
            expect(definition.type, id).toBe('volume');
            expect(definition.conversionFactor, id).toBeUndefined();
        }
    });

    it('teaches the parser the spellings a period cookbook actually prints', () => {
        expect(identifyUnit('gills', { additionalUOMs: HISTORICAL_UNIT_DEFINITIONS })).toBe('gill');
        expect(identifyUnit('wineglassful', { additionalUOMs: HISTORICAL_UNIT_DEFINITIONS })).toBe('wineglass');
        expect(identifyUnit('wine-glass', { additionalUOMs: HISTORICAL_UNIT_DEFINITIONS })).toBe('wineglass');
        expect(identifyUnit('saltspoons', { additionalUOMs: HISTORICAL_UNIT_DEFINITIONS })).toBe('saltspoon');
        expect(identifyUnit('dessertspoonfuls', { additionalUOMs: HISTORICAL_UNIT_DEFINITIONS })).toBe('dessertspoon');
    });
});

/**
 * The vocabulary is only useful if the LINE PARSER reaches it. Before U7 taught `parse-ingredient` these
 * words, `one gill of milk` came back with `unitOfMeasure: null` and the whole clause was dropped by the
 * cookbook mapper, which requires a unit — so a historical measure cost the line its ingredient outright.
 */
describe('parseIngredientLine, on a historical unit', () => {
    it.each([
        ['one gill of milk', 1, 'gill', 'milk'],
        ['two gills of cream', 2, 'gill', 'cream'],
        ['a wineglassful of sherry', 1, 'wineglass', 'sherry'],
        ['one wine-glass of brandy', 1, 'wineglass', 'brandy'],
        ['four saltspoons of salt', 4, 'saltspoon', 'salt'],
        ['one dessertspoonful of flour', 1, 'dessertspoon', 'flour'],
    ])('reads %j as %d %s of %s', (line, value, unit, name) => {
        const parsed = parseIngredientLine(line);

        expect(parsed.quantity).toEqual({ kind: 'exact', value });
        expect(parsed.unit).toBe(unit);
        expect(parsed.name).toBe(name);
        expect(parsed.needsReview).toBe(false);
    });
});
