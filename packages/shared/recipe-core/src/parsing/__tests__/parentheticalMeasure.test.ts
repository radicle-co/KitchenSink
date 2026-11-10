/**
 * `readParenthetical` — what a "(...)" directly after a line's leading amount is (owner ruling 2026-11-08, ruling 2).
 *
 * A dimension ("(9 inch)") is a NOTE on the food and never the unit. A package size ("(28 ounce) can") stays part of
 * the unit, word for word as the cook wrote it. Anything else, or a parenthetical that is not directly after the leading
 * amount ("2 cups flour (sifted)"), is not this module's business.
 */
import { describe, expect, it } from 'vitest';

import { readParenthetical } from '../parentheticalMeasure.js';

describe('readParenthetical: a dimension', () => {
    it.each([
        ['1 (9 inch) double-crust pie pastry', '9 inch'],
        ['2 (9x13 inch) baking dishes', '9x13 inch'],
        ['2 (9 x 13 inch) pans', '9 x 13 inch'],
        ['1 (23 cm) springform pan', '23 cm'],
        ['1 (2 inch) piece ginger', '2 inch'],
        ['1 (10 mm) slice of bread', '10 mm'],
        ['3 (6 inches) rounds', '6 inches'],
        ['2 (1/2 inch) slices bread', '1/2 inch'],
        ['2 (9") crusts', '9"'],
        ['1 (9-inch) pie shell', '9-inch'],
    ])('reads %j as the dimension %j', (line, text) => {
        expect(readParenthetical(line)).toStrictEqual({ kind: 'dimension', text });
    });
});

describe('readParenthetical: a package size', () => {
    it.each([
        ['1 (28 ounce) can crushed tomatoes', '28 ounce', 'can'],
        ['2 (6.5 ounce) cans tomato sauce', '6.5 ounce', 'cans'],
        ['1 (14 oz) can coconut milk', '14 oz', 'can'],
        ['2 (6 ounce) cans tomato paste', '6 ounce', 'cans'],
        ['1 (12 fluid ounce) bottle beer', '12 fluid ounce', 'bottle'],
        ['1 (750 ml) bottle wine', '750 ml', 'bottle'],
        ['3 (8 ounce) packages cream cheese', '8 ounce', 'packages'],
    ])('reads %j as a package of %j in a %j', (line, text, container) => {
        expect(readParenthetical(line)).toStrictEqual({ kind: 'packageSize', text, container });
    });
});

describe('readParenthetical: nothing to say', () => {
    it.each([
        ['2 cups flour (sifted)', 'a parenthetical that is not directly after the amount'],
        ['1 egg', 'no parenthetical'],
        ['flour (9 inch)', 'no leading amount'],
        ['1 (about 4 cups) pound butter', 'an equivalence, not a size'],
        ['1 (optional) onion', 'a word'],
        ['1 (8 ounce) tomato sauce', 'a weight with no container word after it'],
        ['1 (28 ounce)', 'a weight with nothing after it'],
        ['', 'an empty line'],
    ])('reads %j as nothing (%s)', (line) => {
        expect(readParenthetical(line)).toBeUndefined();
    });
});
