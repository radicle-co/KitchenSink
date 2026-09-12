/**
 * The pure halves of a line rebind (plan 002 U5, R17, AE11): which phrase a rebind teaches the corrections store,
 * and how a stored line becomes the request line the update path re-saves.
 */
import { describe, expect, it } from 'vitest';

import { makeIngredientLineRow } from '../../../__fixtures__/index.js';
import { makeRootArm, makeUnresolvedArm } from '../../../ingredients/__fixtures__/foodLookups.fixture.js';
import { correctionPhraseOf, toLineRequest } from '../ingredientRebind.js';

describe('correctionPhraseOf — what a rebind teaches (R17: the correction is about an UNMATCHED name)', () => {
    it.each([
        [
            'the parsed phrase of an imported line, whatever it was bound to',
            makeIngredientLineRow({ sourcePhrase: 'plain flour' }),
            makeRootArm(),
            'plain flour',
        ],
        [
            'the failure’s name for an unresolved line with no phrase',
            makeIngredientLineRow({ sourcePhrase: null }),
            makeUnresolvedArm({
                failure: { name: 'flibbertigibbet', reasonCode: 'no_source_has_it', status: 'NOT_FOUND' },
            }),
            'flibbertigibbet',
        ],
        [
            '⛔ NOTHING for a bound line with no phrase — a catalog name is not an unmatched name, and teaching it would send every later "A" to B',
            makeIngredientLineRow({ sourcePhrase: null }),
            makeRootArm(),
            undefined,
        ],
    ])('%s', (_case, row, arm, expected) => {
        expect(correctionPhraseOf(row, arm)).toBe(expected);
    });
});

describe('toLineRequest — a stored line as the update path re-saves it (AE11)', () => {
    it('carries every fact the cook set: a range, the unit, notes, preparation, section and all four overrides', () => {
        const row = makeIngredientLineRow({
            foodLookupId: 'lookup-1',
            quantity: '1',
            quantityHigh: '2',
            unit: 'cup',
            displayText: '1–2 cups flour, sifted',
            preparation: 'sifted',
            groupLabel: 'For the dough',
            userCalories: '100',
            userProteinG: '3',
            userCarbsG: '21',
            userFatG: '0.5',
        });

        expect(toLineRequest(row)).toStrictEqual({
            ingredientId: 'lookup-1',
            quantity: { kind: 'range', low: 1, high: 2 },
            unit: 'cup',
            notes: '1–2 cups flour, sifted',
            preparation: 'sifted',
            groupLabel: 'For the dough',
            userCalories: 100,
            userProteinG: 3,
            userCarbsG: 21,
            userFatG: 0.5,
        });
    });

    it('omits what the line does not state, rather than sending an empty value the request schema refuses', () => {
        expect(toLineRequest(makeIngredientLineRow({ foodLookupId: 'lookup-2', unit: '' }))).toStrictEqual({
            ingredientId: 'lookup-2',
            quantity: { kind: 'exact', value: 1 },
        });
    });
});
