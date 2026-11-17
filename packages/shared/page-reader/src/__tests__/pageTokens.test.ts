import { describe, expect, it } from 'vitest';

import { isWordMaterial, tokensOf } from '../pageTokens.js';

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

    // Round 9 (code-reviewer LOW 7 on #324): a format character (Unicode Cf) is invisible and no separator. A soft hyphen
    // or a zero-width joiner inside a word is dropped before tokenizing, so "choco&shy;late" is "chocolate". A Persian
    // word written with a zero-width non-joiner reads as the same word written without one.
    it.each([
        ['choco\u00ADlate chips', ['chocolate', 'chips']],
        ['\u200Bflour\u200B', ['flour']],
        ['\uFEFF2 eggs', ['2', 'eggs']],
        ['\u0645\u06CC\u200C\u062E\u0648\u0627\u0645', ['\u0645\u06CC\u062E\u0648\u0627\u0645']],
    ])('drops format characters in %j', (text, tokens) => {
        expect(tokensOf(text)).toEqual(tokens);
    });
});

// Round 9 (code-reviewer LOW 6 on #324): one definition of a word's material, for the tokenizer, the fragment-link count
// and the gate, so a combining mark counts the same everywhere.
describe('isWordMaterial', () => {
    it.each(['a', 'É', '\u0301', '\u093F', '7', '\u0663'])('is true for %j', (char) => {
        expect(isWordMaterial(char)).toBe(true);
    });

    it.each([' ', '.', '▢', '\u00AD', '🥚'])('is false for %j', (char) => {
        expect(isWordMaterial(char)).toBe(false);
    });
});
