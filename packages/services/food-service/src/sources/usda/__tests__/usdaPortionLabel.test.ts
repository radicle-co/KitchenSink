/**
 * `usdaPortionLabel`: one USDA portion row, in any of USDA's three shapes, rendered as the label `food_portions`
 * stores. The label must state USDA's amount, because the stored pair is `{ label, gramWeight }`: an SR row that
 * USDA published as 4 oz at 113 g, stored as `oz` at 113 g, states a false weight to every reader.
 *
 * The three shapes, read from the pinned files on 2026-10-01:
 *
 * | Dataset    | `amount` | `measure_unit`      | `portion_description` | `modifier`        |
 * | ---------- | -------- | ------------------- | --------------------- | ----------------- |
 * | SR Legacy  | `4`      | `undetermined`      | empty                 | `oz`              |
 * | Foundation | `1.0`    | `egg`               | empty                 | `white`           |
 * | FNDDS      | empty    | `undetermined`      | `1 cup, shredded`     | `10159` (a code)  |
 */
import { describe, expect, it } from 'vitest';

import { usdaPortionLabel, type UsdaPortionFields } from '../usdaPortionLabel.js';

/**
 * A portion row with no fields set.
 *
 * @param overrides - The fields the case sets.
 * @returns The row.
 */
function row(overrides: Partial<UsdaPortionFields>): UsdaPortionFields {
    return { amount: null, measureUnit: '', portionDescription: '', modifier: '', ...overrides };
}

describe('usdaPortionLabel', () => {
    it.each<[string, Partial<UsdaPortionFields>, string]>([
        [
            'an SR row: the amount, then the modifier',
            { amount: 1, measureUnit: 'undetermined', modifier: 'cup, chopped' },
            '1 cup, chopped',
        ],
        ['an SR row whose amount is not one', { amount: 4, measureUnit: 'undetermined', modifier: 'oz' }, '4 oz'],
        [
            'an SR fraction, as USDA writes it',
            { amount: 0.33, measureUnit: 'undetermined', modifier: 'cup' },
            '0.33 cup',
        ],
        [
            'a Foundation row: the amount, the unit, then the modifier',
            { amount: 1, measureUnit: 'egg', modifier: 'white' },
            '1 egg white',
        ],
        ['a Foundation row with no modifier', { amount: 2, measureUnit: 'tablespoon' }, '2 tablespoon'],
        [
            'a Foundation row that states a description',
            { amount: 1, measureUnit: 'cup', portionDescription: 'shredded' },
            '1 cup shredded',
        ],
        [
            'an FNDDS row: its description already states the amount',
            { measureUnit: 'undetermined', portionDescription: '1 cup, shredded', modifier: '10159' },
            '1 cup, shredded',
        ],
        [
            'an FNDDS row the live API sends an amount for, without doubling it',
            { amount: 1, measureUnit: 'undetermined', portionDescription: '1 cup', modifier: '10205' },
            '1 cup',
        ],
        ['surrounding space', { amount: 1, measureUnit: ' undetermined ', modifier: '  stick ' }, '1 stick'],
        [
            'an `undetermined` unit in any case',
            { amount: 1, measureUnit: 'Undetermined', modifier: 'slice' },
            '1 slice',
        ],
    ])('renders %s', (_case, fields, label) => {
        expect(usdaPortionLabel(row(fields))).toBe(label);
    });

    it('renders the amount the same way from the CSV `1.0` and the API `1`', () => {
        expect(usdaPortionLabel(row({ amount: Number('1.0'), measureUnit: 'cup' }))).toBe(
            usdaPortionLabel(row({ amount: 1, measureUnit: 'cup' })),
        );
    });

    it.each<[string, Partial<UsdaPortionFields>]>([
        ['an SR row whose amount is zero (FDC ships 18)', { amount: 0, measureUnit: 'undetermined', modifier: 'cup' }],
        ['a negative amount', { amount: -1, measureUnit: 'cup' }],
        ['a non-finite amount', { amount: Number.NaN, measureUnit: 'cup' }],
        ['an infinite amount', { amount: Number.POSITIVE_INFINITY, measureUnit: 'cup' }],
        ['a row that names no measure', { amount: 1, measureUnit: 'undetermined' }],
        ['an orphan row whose unit is not in measure_unit.csv', { amount: 1, measureUnit: '' }],
        [
            'an FNDDS row whose description states no amount',
            { measureUnit: 'undetermined', portionDescription: 'Quantity not specified', modifier: '90000' },
        ],
        ['a row with no amount and only a modifier', { measureUnit: 'undetermined', modifier: 'cup' }],
    ])('states no portion for %s', (_case, fields) => {
        expect(usdaPortionLabel(row(fields))).toBeNull();
    });

    it('never uses an FNDDS portion code as text', () => {
        expect(usdaPortionLabel(row({ amount: 1, measureUnit: 'undetermined', modifier: '90000' }))).toBeNull();
        expect(usdaPortionLabel(row({ amount: 1, measureUnit: 'cup', modifier: '10205' }))).toBe('1 cup');
    });
});
