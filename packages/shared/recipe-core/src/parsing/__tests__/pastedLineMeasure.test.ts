/**
 * `pastedLineMeasureOf` — the measure the editor SAVES for one food of a pasted line, and therefore the measure the
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
import { pastedLineMeasureOf } from '../pastedLineMeasure.js';

describe('pastedLineMeasureOf — the first food of a line', () => {
    it.each([
        ['2 tbsp', { kind: 'exact', value: 2 }, 'tablespoon', { kind: 'exact', value: 2 }, 'tbsp'],
        ['1 T', { kind: 'exact', value: 1 }, 'tablespoon', { kind: 'exact', value: 1 }, 'T'],
        ['1 t', { kind: 'exact', value: 1 }, 'teaspoon', { kind: 'exact', value: 1 }, 't'],
        ['2-3 cups', { kind: 'range', low: 2, high: 3 }, 'cup', { kind: 'range', low: 2, high: 3 }, 'cups'],
        ['1 large', { kind: 'exact', value: 1 }, null, { kind: 'exact', value: 1 }, 'large'],
    ] as const)('keeps the cook’s words for %j', (statedMeasure, quantity, unit, expectedQuantity, expectedUnit) => {
        expect(pastedLineMeasureOf({ quantity, unit, statedMeasure }, 0)).toStrictEqual({
            quantity: expectedQuantity,
            unit: expectedUnit,
        });
    });

    it('keeps the parse’s reading where the words state no amount this reader reads, but the parse read one', () => {
        expect(
            pastedLineMeasureOf({ quantity: { kind: 'exact', value: 1 }, unit: 'gill', statedMeasure: 'one gill' }, 0),
        ).toStrictEqual({ quantity: { kind: 'exact', value: 1 }, unit: 'gill' });
    });

    it('keeps the words, and no amount, where neither the words nor the parse state one', () => {
        expect(
            pastedLineMeasureOf({ quantity: ABSENT_QUANTITY, unit: null, statedMeasure: 'a handful' }, 0),
        ).toStrictEqual({ quantity: ABSENT_QUANTITY, unit: 'a handful' });
    });

    it.each([null, undefined, '   '])(
        'keeps the parse’s reading when the parse kept no words (%j)',
        (statedMeasure) => {
            expect(
                pastedLineMeasureOf({ quantity: { kind: 'exact', value: 2 }, unit: 'cup', statedMeasure }, 0),
            ).toStrictEqual({ quantity: { kind: 'exact', value: 2 }, unit: 'cup' });
        },
    );

    it('spells a parse with no unit as the empty unit, as the editor saves it', () => {
        expect(pastedLineMeasureOf({ quantity: { kind: 'exact', value: 3 }, unit: null }, 0)).toStrictEqual({
            quantity: { kind: 'exact', value: 3 },
            unit: '',
        });
    });
});

describe('pastedLineMeasureOf — a later food of the same line', () => {
    it.each([1, 2])('food %i states no measure: the line gave one amount, and the first food carries it', (index) => {
        expect(
            pastedLineMeasureOf(
                { quantity: { kind: 'exact', value: 2 }, unit: 'tablespoon', statedMeasure: '2 tbsp' },
                index,
            ),
        ).toStrictEqual({ quantity: ABSENT_QUANTITY, unit: '' });
    });
});
