/**
 * The one input check for a facts sheet's free text.
 *
 * The prompt is facts only, so every string a sheet carries must be a fact: a short plain name or a language tag, and
 * never a sentence of source wording. Any code that hands a sheet to the writer calls {@link assertFactsSheetPlain}
 * first.
 *
 * Names are plain by construction: letters, marks, numbers and {@link PLAIN_FACT_PUNCTUATION}, at most
 * {@link MAX_FACT_TEXT_CHARS} code points, and nothing that `looksLikeAddress` flags. A sentence runs past the length,
 * a link fails the address check, and markup needs an angle bracket, so none of them passes.
 *
 * The colon is not in the set. It is the scheme and port marker, and no ingredient name needs it.
 */
import { escapeRegExp } from '../parsing/escapeRegExp.js';

import { looksLikeAddress } from './addressLike.js';
import { SAFETY_CATEGORIES } from './factsSheet.types.js';

import type { FactsSheet } from './factsSheet.types.js';

/** The longest name, unit, action, equipment word or safety fact, in code points. */
export const MAX_FACT_TEXT_CHARS = 80;

/**
 * What a plain name may hold besides letters, marks and numbers: space, apostrophes, comma, parentheses, ampersand,
 * percent, degree, full stop, plus, slash and hyphen. The hyphen stays last so the set reads as a regex class.
 */
export const PLAIN_FACT_PUNCTUATION = " '\u2019,()&%\u00B0.+/-";

/** A name starts with a letter, mark, number or apostrophe (`'nduja`), then holds only the set above. */
const PLAIN_FACT_TEXT = new RegExp(
    `^[\\p{L}\\p{M}\\p{N}'\u2019][\\p{L}\\p{M}\\p{N}${escapeRegExp(PLAIN_FACT_PUNCTUATION)}]*$`,
    'u',
);

/** A BCP 47 tag of language, optional script and optional region: `en`, `pt-BR`, `zh-Hans-CN`. */
const LANGUAGE_TAG = /^[a-z]{2,3}(-[A-Z][a-z]{3})?(-[A-Z]{2})?$/;

/**
 * Whether the text is a plain fact name: short, from the plain character set, and not an address.
 *
 * @param text - A name, unit, action, equipment word or safety fact.
 * @returns True when it is plain. Pure.
 */
export function isPlainFactText(text: string): boolean {
    // Code points, not UTF-16 units: an astral letter is one character of the name.
    return [...text].length <= MAX_FACT_TEXT_CHARS && PLAIN_FACT_TEXT.test(text) && !looksLikeAddress(text);
}

/** A sheet field that is not a fact. The message names the field and never echoes its text. */
export class FactsSheetInvalidError extends Error {
    public readonly field: string;

    public constructor(field: string) {
        super(`facts sheet field ${field} is not a plain fact`);
        this.name = 'FactsSheetInvalidError';
        this.field = field;
        Object.setPrototypeOf(this, FactsSheetInvalidError.prototype);
    }
}

/** Type guard for {@link FactsSheetInvalidError}. */
export function isFactsSheetInvalidError(error: unknown): error is FactsSheetInvalidError {
    return error instanceof FactsSheetInvalidError;
}

/**
 * Refuse a sheet that carries anything but plain facts.
 *
 * @param sheet - The facts sheet.
 * @throws {FactsSheetInvalidError} On the first field that is not a plain fact. Pure.
 */
export function assertFactsSheetPlain(sheet: FactsSheet): void {
    const plain = (field: string, text: string): void => {
        if (!isPlainFactText(text)) {
            throw new FactsSheetInvalidError(field);
        }
    };

    const finite = (field: string, value: number): void => {
        if (!Number.isFinite(value)) {
            throw new FactsSheetInvalidError(field);
        }
    };

    if (!LANGUAGE_TAG.test(sheet.language)) {
        throw new FactsSheetInvalidError('language');
    }

    sheet.ingredientNames.forEach((name, i) => plain(`ingredientNames[${i}]`, name));
    sheet.steps.forEach((step, s) => {
        const at = `steps[${s}]`;

        step.actions.forEach((text, i) => plain(`${at}.actions[${i}]`, text));
        step.ingredients.forEach((text, i) => plain(`${at}.ingredients[${i}]`, text));
        step.equipment.forEach((text, i) => plain(`${at}.equipment[${i}]`, text));
        step.amounts.forEach((amount, i) => {
            finite(`${at}.amounts[${i}].quantity`, amount.quantity);

            if (amount.unit !== null) {
                plain(`${at}.amounts[${i}].unit`, amount.unit);
            }
        });
        step.temperatures.forEach((temperature, i) => {
            finite(`${at}.temperatures[${i}].value`, temperature.value);

            // The sheet is stored as jsonb and read back, so the type alone does not hold at runtime.
            if (temperature.scale !== 'C' && temperature.scale !== 'F') {
                throw new FactsSheetInvalidError(`${at}.temperatures[${i}].scale`);
            }
        });
        step.durations.forEach((duration, i) => {
            const min = `${at}.durations[${i}].minSeconds`;
            const max = `${at}.durations[${i}].maxSeconds`;

            finite(min, duration.minSeconds);
            finite(max, duration.maxSeconds);

            if (duration.minSeconds < 0) {
                throw new FactsSheetInvalidError(min);
            }

            if (duration.maxSeconds < 0 || duration.minSeconds > duration.maxSeconds) {
                throw new FactsSheetInvalidError(max);
            }
        });
        step.safety.forEach((line, i) => {
            if (!SAFETY_CATEGORIES.some((category) => category === line.category)) {
                throw new FactsSheetInvalidError(`${at}.safety[${i}].category`);
            }

            line.facts.forEach((text, f) => plain(`${at}.safety[${i}].facts[${f}]`, text));
        });
    });
}
