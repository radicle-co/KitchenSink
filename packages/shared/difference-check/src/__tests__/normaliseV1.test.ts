/** The v1 pipeline end to end, and its stage order (KTD-2). */
import { describe, expect, it } from 'vitest';

import { NUMBER_TOKEN, UNIT_TOKEN } from '../normalise/foldQuantities.js';
import { normaliseV1 } from '../normalise/normaliseV1.js';

describe('normaliseV1', () => {
    it('answers the stemmed skeleton tokens (m reads as rn), with a number token and a unit token for every quantity', () => {
        expect(normaliseV1('Simmer 2 tbsp of the sauce, 20 minutes')).toEqual([
            'sirnrner',
            NUMBER_TOKEN,
            UNIT_TOKEN,
            'of',
            'the',
            'sauc',
            NUMBER_TOKEN,
            UNIT_TOKEN,
        ]);
    });

    it('reads 0nion as onion', () => {
        expect(normaliseV1('0nion')).toEqual(normaliseV1('onion'));
    });

    it('reads a quantity whose digits are 0 and 1, and whose unit is ml, as a number and a unit', () => {
        expect(normaliseV1('add 10 ml')).toEqual(['add', NUMBER_TOKEN, UNIT_TOKEN]);
        expect(normaliseV1('add 101 ml')).toEqual(['add', NUMBER_TOKEN, UNIT_TOKEN]);
    });

    it('reads 180C and 350F as the same number and unit', () => {
        expect(normaliseV1('bake at 180C')).toEqual(normaliseV1('bake at 350F'));
    });

    it('answers nothing for text with no word', () => {
        expect(normaliseV1('')).toEqual([]);
        expect(normaliseV1(' ​ ')).toEqual([]);
    });
});
