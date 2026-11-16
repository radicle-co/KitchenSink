import { describe, expect, it } from 'vitest';

import { INT4_CEILING } from '@kitchensink/recipe-core';
import { servingsOf } from '../recipeYield.js';

describe('servingsOf', () => {
    it.each([
        [4, 4],
        ['4', 4],
        [' 12 ', 12],
        ['4 servings', 4],
        ['1 serving', 1],
        ['Serves 6', 6],
        ['serves 6', 6],
        ['8 people', 8],
        ['6 Portions', 6],
        [['4'], 4],
        [['4', '8 donuts'], 4],
        [['6 servings', '12 muffins'], 6],
    ])('reads %j as %i servings', (value, servings) => {
        expect(servingsOf(value)).toBe(servings);
    });

    it.each([
        ['Makes 24 cookies'],
        ['24 cookies'],
        ['Makes 4 servings'],
        ['4-6'],
        ['4 to 6'],
        ['4 or 5 servings'],
        ['2 loaves, 12 slices each'],
        ['servings'],
        [''],
        ['   '],
        [0],
        ['0'],
        [-3],
        [4.5],
        ['4.5'],
        [Number.NaN],
        [Number.POSITIVE_INFINITY],
        [INT4_CEILING + 1],
        [[]],
        [['8 donuts', '4']],
        [[''] as unknown],
        [null],
        [undefined],
        [{ '@type': 'QuantitativeValue', value: 4 }],
        [true],
    ])('leaves %j absent: it does not state one whole number of servings', (value) => {
        expect(servingsOf(value)).toBeUndefined();
    });

    it('accepts the largest int4 serving count and refuses the next', () => {
        expect(servingsOf(INT4_CEILING)).toBe(INT4_CEILING);
        expect(servingsOf(String(INT4_CEILING + 1))).toBeUndefined();
    });

    it('refuses an unreasonably long string without reading it', () => {
        expect(servingsOf(`4 ${'servings '.repeat(50_000)}`)).toBeUndefined();
    });
});
