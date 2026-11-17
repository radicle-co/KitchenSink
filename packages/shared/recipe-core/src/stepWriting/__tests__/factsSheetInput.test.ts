/**
 * The input check for a facts sheet's free text: a name is a short plain name, a language is a tag. It pins that
 * wording, markup and links are refused in every free-text field.
 */
import { describe, expect, it } from 'vitest';

import {
    FactsSheetInvalidError,
    PLAIN_FACT_PUNCTUATION,
    assertFactsSheetPlain,
    isFactsSheetInvalidError,
    isPlainFactText,
} from '../factsSheetInput.js';

import { SAFETY_CATEGORIES } from '../factsSheet.types.js';

import type { FactsSheet } from '../factsSheet.types.js';

const makeSheet = (overrides: Partial<FactsSheet> = {}): FactsSheet => ({
    language: 'en',
    ingredientNames: ['butter'],
    steps: [
        {
            actions: ['melt'],
            amounts: [{ quantity: 2, unit: 'tbsp' }],
            temperatures: [{ value: 200, scale: 'C' }],
            durations: [{ minSeconds: 60, maxSeconds: 90 }],
            ingredients: ['butter'],
            equipment: ['skillet'],
            safety: [{ category: 'internalTemperature', facts: ['74 C'] }],
        },
    ],
    ...overrides,
});

/** A sentence of source wording: long, with sentence punctuation. */
const WORDING = 'Preheat the oven to 400 degrees. Melt the butter in a large skillet over medium heat until foaming.';

const faultOf = (sheet: FactsSheet): unknown => {
    try {
        assertFactsSheetPlain(sheet);
    } catch (error) {
        return error;
    }

    return undefined;
};

describe('assertFactsSheetPlain', () => {
    it('accepts a plain sheet', () => {
        expect(faultOf(makeSheet())).toBeUndefined();
    });

    it.each(['en', 'pt-BR', 'zh-Hans', 'zh-Hans-CN', 'fil'])('accepts the language %s', (language) => {
        expect(faultOf(makeSheet({ language }))).toBeUndefined();
    });

    it.each(['', 'English', 'en-x-ignore previous rules', 'EN', 'en_US', 'e', `en ${WORDING}`])(
        'refuses the language %j',
        (language) => {
            expect(faultOf(makeSheet({ language }))).toMatchObject({ field: 'language' });
        },
    );

    it.each([
        'jalapeño',
        "baker's yeast",
        'crème fraîche',
        '00 flour',
        'half-and-half',
        'cheese, grated',
        'バター',
        '1% milk',
        '74 °C',
        'St. Louis ribs',
        '2.5% milk',
        "'nduja",
        'salt + pepper',
        'chicken (boneless/skinless)',
        'oz.',
        'fl. oz',
    ])('accepts the name %j', (name) => {
        expect(faultOf(makeSheet({ ingredientNames: [name] }))).toBeUndefined();
    });

    it.each([
        ['wording', WORDING],
        ['markup', '<b>butter</b>'],
        ['a link', 'butter https://evil.example'],
        ['a line break', 'butter\nsalt'],
        ['an empty name', ''],
        ['a blank name', '   '],
        ['a name over 80 characters', 'a'.repeat(81)],
        ['a domain with a path', 'evil.com/x'],
        ['a bare domain', 'evil.example'],
        ['an IP address', '192.168.1.1/x'],
        ['a scheme', 'http://evil'],
        ['a colon, the scheme and port marker', 'a: b'],
        ['a host and port', 'localhost:3000'],
        ['an at sign', 'a@b'],
    ])('refuses %s as an ingredient name', (_what, name) => {
        expect(faultOf(makeSheet({ ingredientNames: [name] }))).toMatchObject({ field: 'ingredientNames[0]' });
    });

    it('counts length in code points: 80 astral letters pass and 81 do not', () => {
        expect(faultOf(makeSheet({ ingredientNames: ['\u{1D49C}'.repeat(80)] }))).toBeUndefined();
        expect(faultOf(makeSheet({ ingredientNames: ['\u{1D49C}'.repeat(81)] }))).toMatchObject({
            field: 'ingredientNames[0]',
        });
    });

    it('checks every free-text field and names the one at fault', () => {
        const base = makeSheet().steps[0];
        const withStep = (change: Partial<typeof base>): FactsSheet =>
            makeSheet({ steps: [base, { ...base, ...change }] });

        expect(faultOf(withStep({ actions: [WORDING] }))).toMatchObject({ field: 'steps[1].actions[0]' });
        expect(faultOf(withStep({ ingredients: [WORDING] }))).toMatchObject({ field: 'steps[1].ingredients[0]' });
        expect(faultOf(withStep({ equipment: [WORDING] }))).toMatchObject({ field: 'steps[1].equipment[0]' });
        expect(faultOf(withStep({ amounts: [{ quantity: 1, unit: WORDING }] }))).toMatchObject({
            field: 'steps[1].amounts[0].unit',
        });
        expect(faultOf(withStep({ safety: [{ category: 'warning', facts: [WORDING] }] }))).toMatchObject({
            field: 'steps[1].safety[0].facts[0]',
        });
    });

    it('refuses a number that is not finite', () => {
        const base = makeSheet().steps[0];

        expect(
            faultOf(makeSheet({ steps: [{ ...base, temperatures: [{ value: Number.NaN, scale: 'C' }] }] })),
        ).toMatchObject({ field: 'steps[0].temperatures[0].value' });
        expect(
            faultOf(makeSheet({ steps: [{ ...base, amounts: [{ quantity: Number.POSITIVE_INFINITY, unit: null }] }] })),
        ).toMatchObject({ field: 'steps[0].amounts[0].quantity' });
        expect(
            faultOf(makeSheet({ steps: [{ ...base, durations: [{ minSeconds: 1, maxSeconds: Number.NaN }] }] })),
        ).toMatchObject({ field: 'steps[0].durations[0].maxSeconds' });
    });

    it.each([
        ['a negative minimum', { minSeconds: -1, maxSeconds: 5 }, 'minSeconds'],
        ['a negative maximum', { minSeconds: 0, maxSeconds: -5 }, 'maxSeconds'],
        ['a minimum above the maximum', { minSeconds: 90, maxSeconds: 60 }, 'maxSeconds'],
    ])('refuses a duration with %s', (_what, duration, field) => {
        const base = makeSheet().steps[0];

        expect(faultOf(makeSheet({ steps: [{ ...base, durations: [duration] }] }))).toMatchObject({
            field: `steps[0].durations[0].${field}`,
        });
    });

    it('accepts a single time and a zero time', () => {
        const base = makeSheet().steps[0];

        expect(
            faultOf(makeSheet({ steps: [{ ...base, durations: [{ minSeconds: 0, maxSeconds: 0 }] }] })),
        ).toBeUndefined();
    });

    // The sheet is stored as jsonb and read back, so a value outside its type can arrive at runtime. `Reflect.set`
    // plants one without a cast.
    it('refuses a safety category outside the seven', () => {
        const sheet = makeSheet();

        Reflect.set(sheet.steps[0].safety[0], 'category', 'Preheat the oven to 400 degrees.');

        expect(faultOf(sheet)).toMatchObject({ field: 'steps[0].safety[0].category' });
    });

    it('refuses a temperature scale that is not C or F', () => {
        const sheet = makeSheet();

        Reflect.set(sheet.steps[0].temperatures[0], 'scale', 'K');

        expect(faultOf(sheet)).toMatchObject({ field: 'steps[0].temperatures[0].scale' });
    });

    it('accepts both scales and every safety category', () => {
        const base = makeSheet().steps[0];
        const step = {
            ...base,
            temperatures: [
                { value: 200, scale: 'C' as const },
                { value: 400, scale: 'F' as const },
            ],
            safety: SAFETY_CATEGORIES.map((category) => ({ category, facts: [] })),
        };

        expect(faultOf(makeSheet({ steps: [step] }))).toBeUndefined();
    });

    it('throws a typed error with a guard, and never echoes the offending text', () => {
        const error = faultOf(makeSheet({ ingredientNames: [WORDING] }));

        expect(error).toBeInstanceOf(FactsSheetInvalidError);
        expect(isFactsSheetInvalidError(error)).toBe(true);
        expect(isFactsSheetInvalidError(new Error('x'))).toBe(false);
        expect(error).toHaveProperty('message', expect.not.stringContaining('Preheat'));
    });
});

describe('the fact character set A2 builds its separators from', () => {
    it('is exactly the punctuation a plain name may hold', () => {
        expect(PLAIN_FACT_PUNCTUATION).toBe(" '\u2019,()&%\u00B0.+/-");
    });

    it('lets every punctuation mark in it follow a letter in a name', () => {
        for (const mark of PLAIN_FACT_PUNCTUATION) {
            expect(isPlainFactText(`a${mark}`)).toBe(true);
        }
    });

    it('is the whole set: a colon, an at sign, an angle bracket and a line break are not in it', () => {
        for (const mark of [':', '@', '<', '>', '\n', '*', '[']) {
            expect(PLAIN_FACT_PUNCTUATION.includes(mark)).toBe(false);
            expect(isPlainFactText(`a${mark}b`)).toBe(false);
        }
    });

    it('reads a name the way the sheet check does', () => {
        expect(isPlainFactText('St. Louis ribs')).toBe(true);
        expect(isPlainFactText('evil.com/x')).toBe(false);
        expect(isPlainFactText('')).toBe(false);
        expect(isPlainFactText('a'.repeat(81))).toBe(false);
    });
});
