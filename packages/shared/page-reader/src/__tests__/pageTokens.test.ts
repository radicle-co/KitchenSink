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

    // A plugin's checkbox, a bullet, a star or an emoji is decoration, not a word: "▢ 2 tablespoons butter" is the schema's
    // "2 tablespoons butter". Only letters, combining marks and digits are word material, in any script.
    it.each([
        ['▢ 2 tablespoons butter', ['2', 'tablespoons', 'butter']],
        ['☐ 1 egg ✓', ['1', 'egg']],
        ['★★★★☆ 4.5', ['4', '.', '5']],
        ['🥚 2 eggs 🍳', ['2', 'eggs']],
        ['→ Mix well ▸', ['mix', 'well']],
        ['日本の 料理', ['日本の', '料理']],
        ['जीरा पाउडर', ['जीरा', 'पाउडर']],
    ])('reads %j with its decoration dropped', (text, tokens) => {
        expect(tokensOf(text)).toEqual(tokens);
    });

    it('does not join a dash that is not between digits', () => {
        expect(tokensOf('half-and-half 2 - dash')).toEqual(['half', 'and', 'half', '2', 'dash']);
    });
});
