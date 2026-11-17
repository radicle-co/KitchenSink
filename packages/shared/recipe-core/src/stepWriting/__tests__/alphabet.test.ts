/**
 * The output language's alphabet: what a fact name and a written step may be made of, and the address rule that goes
 * with it. One table per language, so adding a language fails to compile until it has all three.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';

import { ALPHABET_BY_LANGUAGE, OUTPUT_LANGUAGES, PLAIN_FACT_PUNCTUATION, isOutputLanguage } from '../alphabet.js';
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
            ['a combining mark beside a dot', 'evil̀.com'],
            ['a combining grapheme joiner', 'evil͏.com'],
            ['a Devanagari host', 'हिंदी.भारत'],
            ['a Thai host', 'ไทยดี.com'],
            ['full-width letters', 'ｅｖｉｌ.com'],
            ['a zero-width joiner in a host', 'evil‍.com'],
            ['an abbreviation spelt into a host', 'e.g.com'],
            ['a short host', 't.co'],
            ['an ideographic full stop', 'evil。com'],
            ['a Japanese word', '梅'],
            ['a Bengali word', 'ঘি'],
            ['a tight dot that is not on the list', 'U.S. beef'],
        ],
        accepted: ['A.1. sauce', '2 fl.oz.', 'crème fraîche', 'jalapeño', 'St. Louis', '2.5', '½ cup'],
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

    it('gives each language its name allowlist, prose allowlist and address rule', () => {
        for (const language of OUTPUT_LANGUAGES) {
            const alphabet = ALPHABET_BY_LANGUAGE[language];

            expect(alphabet.name).toBeInstanceOf(RegExp);
            expect(alphabet.prose).toBeInstanceOf(RegExp);
            expect(typeof alphabet.addressRule).toBe('function');
        }
    });

    it('guards the union: en is a language, anything else is not', () => {
        expect(isOutputLanguage('en')).toBe(true);
        expect(['ja', 'pt-BR', 'EN', '', 'en-US'].some(isOutputLanguage)).toBe(false);
    });

    it('keeps the plain-name punctuation as the one list A2 reads', () => {
        expect(PLAIN_FACT_PUNCTUATION).toBe(" '’,()&%°.+/-");
    });
});
