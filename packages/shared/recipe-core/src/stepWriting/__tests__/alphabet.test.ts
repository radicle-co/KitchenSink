/**
 * The output language's alphabet: what a fact name and a written step may be made of, and the address rule that goes
 * with it. One table per language, so adding a language fails to compile until it has all three.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';

import { ALPHABET_BY_LANGUAGE, OUTPUT_LANGUAGES, isOutputLanguage } from '../alphabet.js';
import { isPlainFactText } from '../factsSheetInput.js';
import { parseStepAnswer } from '../stepAnswer.js';

import type { OutputLanguage } from '../alphabet.js';

interface LanguageCases {
    /** Names and sentences the door must refuse, one row per vector. */
    readonly refused: readonly (readonly [string, string])[];
    /** Names that must pass, as written and as a sentence. */
    readonly accepted: readonly string[];
    /** The same words spelt with a different dot that the language's address rule must read as a dot. */
    readonly dotted: readonly string[];
}

/**
 * One table per language. `Record<OutputLanguage, ...>` makes a new language fail to compile here until it brings its
 * own refusals, acceptances and dot cases.
 */
const CASES: Record<OutputLanguage, LanguageCases> = {
    en: {
        refused: [
            ['a dotless i', '\u0131'],
            ['a Latin small letter iota', '\u0269'],
            ['a long s', '\u017F'],
            ['a kra', '\u0138'],
            ['a small capital L', '\u029F'],
            ['a small capital I', '\u026A'],
            ['a Latin small capital A', '\u1D00'],
            ['a look-alike inside a word', 'butter\u0131'],
            ['a combining mark beside a dot', 'evil\u0300.com'],
            ['a combining grapheme joiner', 'evil\u034F.com'],
            ['a Devanagari host', '\u0939\u093F\u0902\u0926\u0940.\u092D\u093E\u0930\u0924'],
            ['a Thai host', '\u0E44\u0E17\u0E22\u0E14\u0E35.com'],
            ['full-width letters', '\uFF45\uFF56\uFF49\uFF4C.com'],
            ['full-width letters with no dot', '\uFF21\uFF22\uFF23'],
            ['a full-width digit', '\uFF13 eggs'],
            ['a zero-width joiner in a host', 'evil\u200D.com'],
            ['an abbreviation spelt into a host', 'e.g.com'],
            ['a short host', 't.co'],
            ['an ideographic full stop', 'evil\u3002com'],
            ['a Japanese word', '\u6885'],
            ['a Bengali word', '\u0998\u09BF'],
            ['a tight dot that is not on the list', 'U.S. beef'],
        ],
        accepted: [
            'cr\u00E8me br\u00FBl\u00E9e',
            'jalape\u00F1o',
            'pi\u00F1a',
            'a\u00E7a\u00ED',
            'sm\u00F8rrebr\u00F8d',
            '\u0153uf',
            'Wei\u00DFwurst',
            '\u00C9CLAIR',
            'A.1. sauce',
            '2 fl.oz.',
            'cr\u00E8me fra\u00EEche',
            'jalapen\u0303o',
            'St. Louis',
            '2.5',
            '\u00BD cup',
            '\u2153 cup',
            '\u215E tsp',
            '\u00BC cup',
        ],
        dotted: ['evil.com', 'evil.cooking', 'evil.zip'],
    },
};

describe.each(OUTPUT_LANGUAGES)('the %s alphabet', (language) => {
    const cases = CASES[language];

    it.each(cases.refused)('refuses %s as a name', (_what, text) => {
        expect(isPlainFactText(text, language)).toBe(false);
    });

    it.each(cases.refused)('refuses %s in a written step', (_what, text) => {
        const reply = JSON.stringify({ steps: [{ text: `Open ${text} now.`, covers: [0] }] });

        expect(parseStepAnswer(reply, 80, language)).toEqual({ refused: 'unsafeText' });
    });

    it.each(cases.accepted)('accepts %j as a name and in a written step', (text) => {
        const reply = JSON.stringify({ steps: [{ text: `Add ${text}`, covers: [0] }] });

        expect(isPlainFactText(text, language)).toBe(true);
        expect(parseStepAnswer(reply, 80, language)).toMatchObject({ ok: true });
    });

    it.each(cases.dotted)('reads %j as an address in both doors', (text) => {
        expect(ALPHABET_BY_LANGUAGE[language].addressRule(text)).toBe(true);
        expect(isPlainFactText(text, language)).toBe(false);
    });

    it('accepts a time with a colon in a written step, though a name may not hold one', () => {
        const reply = JSON.stringify({ steps: [{ text: 'Rest for 1:30.', covers: [0] }] });

        expect(parseStepAnswer(reply, 80, language)).toMatchObject({ ok: true });
        expect(isPlainFactText('1:30', language)).toBe(false);
    });
});

describe('the registry', () => {
    it('has exactly one entry per output language, checked at compile time and at run time', () => {
        expectTypeOf<keyof typeof ALPHABET_BY_LANGUAGE>().toEqualTypeOf<OutputLanguage>();
        expectTypeOf<(typeof OUTPUT_LANGUAGES)[number]>().toEqualTypeOf<OutputLanguage>();
        expect(Object.keys(ALPHABET_BY_LANGUAGE).sort()).toEqual([...OUTPUT_LANGUAGES].sort());
        expect(Object.keys(CASES).sort()).toEqual([...OUTPUT_LANGUAGES].sort());
    });

    it('guards the union: en is a language, anything else is not', () => {
        expect(isOutputLanguage('en')).toBe(true);
        expect(['ja', 'pt-BR', 'EN', '', 'en-US'].some(isOutputLanguage)).toBe(false);
    });
});
