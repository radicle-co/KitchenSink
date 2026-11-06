/**
 * `pastedLineRowOf` — the measure and name the editor SAVES for one food of a pasted line, and therefore the measure the
 * paste matcher must key its verdict on (ADR-0071).
 *
 * ⛔ One rule, two callers. The editor (`pastedLines.ts`) saves a pasted row with this measure, and recipe-service's
 * `matchJudgementOf` keys the gate's verdict with it. Where they differed, `2 tbsp` saved unit `tbsp` while the matcher
 * keyed `tablespoon`, and the save path paid the gate again for a line it had already judged.
 *
 * The rules, from the editor's former `cookMeasureOf`: the cook's own words win (spec §7.5.3); the parse's reading
 * stands where those words state no amount this reader reads but the parse read one ("one cup"), or where the parse kept
 * no words; and only the FIRST food of a line carries the line's measure.
 */
import { describe, expect, it } from 'vitest';

import { ABSENT_QUANTITY } from '../../ingredientQuantity.js';
import { pastedLineRowOf } from '../pastedLineMeasure.js';

describe('pastedLineRowOf — the first food of a line', () => {
    it.each([
        ['2 tbsp', { kind: 'exact', value: 2 }, 'tablespoon', { kind: 'exact', value: 2 }, 'tbsp'],
        ['1 T', { kind: 'exact', value: 1 }, 'tablespoon', { kind: 'exact', value: 1 }, 'T'],
        ['1 t', { kind: 'exact', value: 1 }, 'teaspoon', { kind: 'exact', value: 1 }, 't'],
        ['2-3 cups', { kind: 'range', low: 2, high: 3 }, 'cup', { kind: 'range', low: 2, high: 3 }, 'cups'],
        ['1 large', { kind: 'exact', value: 1 }, null, { kind: 'exact', value: 1 }, 'large'],
    ] as const)('keeps the cook’s words for %j', (statedMeasure, quantity, unit, expectedQuantity, expectedUnit) => {
        expect(pastedLineRowOf({ quantity, unit, statedMeasure }, 0, 'onion')).toStrictEqual({
            quantity: expectedQuantity,
            unit: expectedUnit,
            name: 'onion',
        });
    });

    it('keeps the parse’s reading where the words state no amount this reader reads, but the parse read one', () => {
        expect(
            pastedLineRowOf(
                { quantity: { kind: 'exact', value: 1 }, unit: 'gill', statedMeasure: 'one gill' },
                0,
                'milk',
            ),
        ).toStrictEqual({ quantity: { kind: 'exact', value: 1 }, unit: 'gill', name: 'milk' });
    });

    it('keeps the words, and no amount, where neither the words nor the parse state one', () => {
        expect(
            pastedLineRowOf({ quantity: ABSENT_QUANTITY, unit: null, statedMeasure: 'a handful' }, 0, 'parsley'),
        ).toStrictEqual({ quantity: ABSENT_QUANTITY, unit: 'a handful', name: 'parsley' });
    });

    it.each([null, undefined, '   '])(
        'keeps the parse’s reading when the parse kept no words (%j)',
        (statedMeasure) => {
            expect(
                pastedLineRowOf({ quantity: { kind: 'exact', value: 2 }, unit: 'cup', statedMeasure }, 0, 'flour'),
            ).toStrictEqual({ quantity: { kind: 'exact', value: 2 }, unit: 'cup', name: 'flour' });
        },
    );

    it('spells a parse with no unit as the empty unit, as the editor saves it', () => {
        expect(pastedLineRowOf({ quantity: { kind: 'exact', value: 3 }, unit: null }, 0, 'eggs')).toStrictEqual({
            quantity: { kind: 'exact', value: 3 },
            unit: '',
            name: 'eggs',
        });
    });
});

/**
 * ADR-0026 §8 (owner ruling 2026-08-26): a size word is a unit. The parse prompt and the CRF promotion both keep a
 * leading size word in the food's NAME ("3 large eggs" → name `large eggs`, no unit), so §8's merge rescue never fires
 * on a plain count. The row therefore takes the size word as its unit, so the line reads "3 large eggs" beside any
 * matched food, and `unitToGrams` can meet a catalog portion labelled `large`.
 */
describe('pastedLineRowOf — a size word is a unit (ADR-0026 §8)', () => {
    it.each([
        ['large eggs', 'large', 'eggs'],
        ['Large eggs', 'Large', 'eggs'],
        ['small onion', 'small', 'onion'],
        ['medium yellow onions', 'medium', 'yellow onions'],
        ['jumbo shrimp', 'jumbo', 'shrimp'],
        ['extra large eggs', 'extra large', 'eggs'],
        ['extra-large eggs', 'extra-large', 'eggs'],
    ] as const)('a counted %j takes its size word as the unit', (phrase, unit, name) => {
        expect(
            pastedLineRowOf({ quantity: { kind: 'exact', value: 3 }, unit: null, statedMeasure: '3' }, 0, phrase),
        ).toStrictEqual({
            quantity: { kind: 'exact', value: 3 },
            unit,
            name,
        });
    });

    it('moves the size word on a range too', () => {
        expect(
            pastedLineRowOf(
                { quantity: { kind: 'range', low: 2, high: 3 }, unit: null, statedMeasure: '2-3' },
                0,
                'large eggs',
            ),
        ).toStrictEqual({ quantity: { kind: 'range', low: 2, high: 3 }, unit: 'large', name: 'eggs' });
    });

    it('leaves the name alone when the line already states a unit', () => {
        expect(
            pastedLineRowOf(
                { quantity: { kind: 'exact', value: 2 }, unit: 'cup', statedMeasure: '2 cups' },
                0,
                'large-curd cottage cheese',
            ),
        ).toStrictEqual({ quantity: { kind: 'exact', value: 2 }, unit: 'cups', name: 'large-curd cottage cheese' });
        expect(
            pastedLineRowOf(
                { quantity: { kind: 'exact', value: 1 }, unit: 'cup', statedMeasure: '1 cup' },
                0,
                'small pasta shells',
            ),
        ).toStrictEqual({ quantity: { kind: 'exact', value: 1 }, unit: 'cup', name: 'small pasta shells' });
    });

    it('leaves the name alone when the line states no amount (nothing to count)', () => {
        expect(
            pastedLineRowOf({ quantity: ABSENT_QUANTITY, unit: null, statedMeasure: null }, 0, 'large eggs'),
        ).toStrictEqual({
            quantity: ABSENT_QUANTITY,
            unit: '',
            name: 'large eggs',
        });
    });

    it('never empties the name: a size word alone stays the name', () => {
        expect(
            pastedLineRowOf({ quantity: { kind: 'exact', value: 2 }, unit: null, statedMeasure: '2' }, 0, 'large'),
        ).toStrictEqual({
            quantity: { kind: 'exact', value: 2 },
            unit: '',
            name: 'large',
        });
    });

    it('does not read a size word that is not the first word', () => {
        expect(
            pastedLineRowOf(
                { quantity: { kind: 'exact', value: 3 }, unit: null, statedMeasure: '3' },
                0,
                'eggs, large',
            ),
        ).toStrictEqual({
            quantity: { kind: 'exact', value: 3 },
            unit: '',
            name: 'eggs, large',
        });
        expect(
            pastedLineRowOf(
                { quantity: { kind: 'exact', value: 3 }, unit: null, statedMeasure: '3' },
                0,
                'largemouth bass',
            ),
        ).toStrictEqual({
            quantity: { kind: 'exact', value: 3 },
            unit: '',
            name: 'largemouth bass',
        });
    });
});

describe('pastedLineRowOf — a later food of the same line', () => {
    it.each([1, 2])('food %i states no measure: the line gave one amount, and the first food carries it', (index) => {
        expect(
            pastedLineRowOf(
                { quantity: { kind: 'exact', value: 2 }, unit: 'tablespoon', statedMeasure: '2 tbsp' },
                index,
                'large eggs',
            ),
        ).toStrictEqual({ quantity: ABSENT_QUANTITY, unit: '', name: 'large eggs' });
    });
});
