import { describe, expect, it } from 'vitest';

import { tokensOf } from '../pageTokens.js';

describe('tokensOf', () => {
    it.each([
        ['1 1/2 cups flour', ['1', '1', '/', '2', 'cups', 'flour']],
        ['1½ cups flour', ['1', '1', '/', '2', 'cups', 'flour']],
        ['1 ½ cups flour', ['1', '1', '/', '2', 'cups', 'flour']],
        ['½ cup', ['1', '/', '2', 'cup']],
        ['1⁄2 cup', ['1', '/', '2', 'cup']],
        ['1 / 2 cup', ['1', '/', '2', 'cup']],
        ['750g flour', ['750', 'g', 'flour']],
        ['9×13 pan', ['9', 'x', '13', 'pan']],
        ['9x13 pan', ['9', 'x', '13', 'pan']],
        ['1.5 cups', ['1', '.', '5', 'cups']],
        ['1–2 cups', ['1', '-', '2', 'cups']],
        ['1 - 2 cups', ['1', '-', '2', 'cups']],
        ['butter (softened), diced', ['butter', 'softened', 'diced']],
        ['350°F', ['350', 'f']],
        ['Café CRÈME', ['café', 'crème']],
        ['', []],
        ['  ,; () ', []],
    ])('reads %j', (text, tokens) => {
        expect(tokensOf(text)).toEqual(tokens);
    });

    it('keeps a range, a fraction, a decimal and a glued fraction apart', () => {
        const all = ['1-2', '1/2', '1.5', '15', '1 1/2', '11/2'].map((text) => tokensOf(text).join(' '));

        expect(new Set(all).size).toBe(all.length);
    });

    it('does not join a dash that is not between digits', () => {
        expect(tokensOf('half-and-half 2 - dash')).toEqual(['half', 'and', 'half', '2', 'dash']);
    });
});
