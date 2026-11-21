/**
 * v1's own copy of the unit words (qse F-5): frozen, so a unit alias added to recipe-core later cannot change an answer
 * v1 gave.
 */
import { describe, expect, it } from 'vitest';

import { V1_UNITS } from '../v1Units.js';

describe('V1_UNITS', () => {
    it('holds only lower case words made of letters, with no digit and no space', () => {
        for (const unit of V1_UNITS) {
            expect(unit).toMatch(/^\p{L}+$/u);
            expect(unit).toBe(unit.toLowerCase());
        }
    });

    it.each([
        'g',
        'kg',
        'mg',
        'oz',
        'lb',
        'lbs',
        'cup',
        'cups',
        'tbsp',
        'tsp',
        'ml',
        'l',
        'litre',
        'pint',
        'quart',
        'gallon',
        'clove',
        'slice',
        'pinch',
        'inch',
        'inches',
        'cm',
        'mm',
        'minute',
        'minutes',
        'min',
        'mins',
        'hour',
        'hours',
        'hr',
        'second',
        'seconds',
        'sec',
        'c',
        'f',
        'celsius',
        'fahrenheit',
        'degree',
        'degrees',
    ])('knows %j', (unit) => {
        expect(V1_UNITS.has(unit)).toBe(true);
    });

    it.each(['onion', 'stir', 'bake', 'oven', 'heat', 'butter'])('does not hold the food or action word %j', (word) => {
        expect(V1_UNITS.has(word)).toBe(false);
    });
});
