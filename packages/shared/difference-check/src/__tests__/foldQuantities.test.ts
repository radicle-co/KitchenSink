/**
 * Stage 3 of v1: a pure number becomes ONE number token, a unit ONE unit token, and a number with its unit (`180c`,
 * `20cm`, `350f`) a number token and a unit token. It runs before the skeleton, which would otherwise turn `180` into
 * `l8o` and `ml` into `rnl` (KTD-2).
 */
import { describe, expect, it } from 'vitest';

import { foldQuantities, NUMBER_TOKEN, UNIT_TOKEN } from '../normalise/foldQuantities.js';
import { tokenise } from '../normalise/tokenise.js';

const fold = (text: string): string[] => foldQuantities(tokenise(text));

describe('foldQuantities', () => {
    it.each(['2', '350', '1.5', '1/2', '2-3', '1,000', '٣'])('folds the number %j to one number token', (number) => {
        expect(fold(number)).toEqual([NUMBER_TOKEN]);
    });

    it.each(['ml', 'tbsp', 'cups', 'grams', 'minutes', 'inches', 'celsius', 'kg', 'oz'])(
        'folds the unit %j to one unit token',
        (unit) => {
            expect(fold(unit)).toEqual([UNIT_TOKEN]);
        },
    );

    it.each([
        ['180c', [NUMBER_TOKEN, UNIT_TOKEN]],
        ['20cm', [NUMBER_TOKEN, UNIT_TOKEN]],
        ['350f', [NUMBER_TOKEN, UNIT_TOKEN]],
        ['1.5l', [NUMBER_TOKEN, UNIT_TOKEN]],
        ['2-3min', [NUMBER_TOKEN, UNIT_TOKEN]],
    ])('folds the compound %j to a number and a unit', (text, tokens) => {
        expect(fold(text)).toEqual(tokens);
    });

    it('leaves a word alone, and a digit inside a word (0nion) for the skeleton to read', () => {
        expect(fold('onion 0nion 3rd')).toEqual(['onion', '0nion', '3rd']);
    });

    it('makes every quantity the same token, so a changed amount changes nothing', () => {
        expect(fold('add 2 tbsp of milk')).toEqual(fold('add 15 ml of milk'));
        expect(fold('bake at 180c')).toEqual(fold('bake at 350f'));
    });

    it('cannot collide with a word: the sentinels hold no letter or digit', () => {
        expect(NUMBER_TOKEN).not.toMatch(/[\p{L}\p{N}]/u);
        expect(UNIT_TOKEN).not.toMatch(/[\p{L}\p{N}]/u);
        expect(NUMBER_TOKEN).not.toBe(UNIT_TOKEN);
    });
});
