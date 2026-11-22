/**
 * Stage 2 of v1: a token is a run of letters and digits, and a number written with a decimal point, a fraction slash or
 * a range dash stays ONE token, because the fold after it must see "1/2" and "2-3" as one number (KTD-2).
 */
import { describe, expect, it } from 'vitest';

import { tokenise } from '../normalise/tokenise.js';

describe('tokenise', () => {
    it('splits on anything that is not a letter or a digit', () => {
        expect(tokenise('stir, then; fold (gently) in-the pan.')).toEqual([
            'stir',
            'then',
            'fold',
            'gently',
            'in',
            'the',
            'pan',
        ]);
    });

    it.each([
        ['1.5 cups', ['1.5', 'cups']],
        ['1/2 cup', ['1/2', 'cup']],
        ['2-3 minutes', ['2-3', 'minutes']],
        ['350–75 g', ['350–75', 'g']],
        ['1,5 l', ['1,5', 'l']],
    ])('keeps the number in %j as one token', (text, tokens) => {
        expect(tokenise(text)).toEqual(tokens);
    });

    it('keeps a number with its letters as one token, for the fold to split: 180c, 20cm, 0nion', () => {
        expect(tokenise('bake at 180c for 20cm of 0nion')).toEqual([
            'bake',
            'at',
            '180c',
            'for',
            '20cm',
            'of',
            '0nion',
        ]);
    });

    it('does not join a comma or a dash between two WORDS', () => {
        expect(tokenise('salt,pepper')).toEqual(['salt', 'pepper']);
        expect(tokenise('salt-pepper')).toEqual(['salt', 'pepper']);
    });

    it('answers nothing for text with no letters or digits', () => {
        expect(tokenise('  ... --- !!! ')).toEqual([]);
        expect(tokenise('')).toEqual([]);
    });

    it('reads letters of any script as letters', () => {
        expect(tokenise('смешай こんにちは')).toEqual(['смешай', 'こんにちは']);
    });
});
