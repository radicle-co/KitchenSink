/**
 * The one input check for a facts sheet's free text.
 *
 * The prompt is facts only, so every string a sheet carries must be a fact: a short plain name or a language tag, and
 * never a sentence of source wording. The sheet builder and the prompt builder both call
 * {@link assertFactsSheetPlain}, so a field cannot carry wording in at either door.
 *
 * Names are plain by construction: letters, marks, numbers, spaces, apostrophes, hyphens, commas, parentheses and
 * ampersands, at most {@link MAX_FACT_TEXT_CHARS} code points. A sentence ends in a full stop and runs past that, a
 * link needs a colon, a slash or a dot, and markup needs an angle bracket, so none of them passes.
 */
import type { FactsSheet } from './factsSheet.types.js';

/** The longest name, unit, action, equipment word or safety fact, in code points. */
export const MAX_FACT_TEXT_CHARS = 80;

const PLAIN_FACT_TEXT = /^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} '’,()&-]*$/u;

/** A BCP 47 tag of language, optional script and optional region: `en`, `pt-BR`, `zh-Hans-CN`. */
const LANGUAGE_TAG = /^[a-z]{2,3}(-[A-Z][a-z]{3})?(-[A-Z]{2})?$/;

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
        // Code points, not UTF-16 units: an astral letter is one character of the name.
        if ([...text].length > MAX_FACT_TEXT_CHARS || !PLAIN_FACT_TEXT.test(text)) {
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
        step.temperatures.forEach((temperature, i) => finite(`${at}.temperatures[${i}].value`, temperature.value));
        step.durations.forEach((duration, i) => {
            finite(`${at}.durations[${i}].minSeconds`, duration.minSeconds);
            finite(`${at}.durations[${i}].maxSeconds`, duration.maxSeconds);
        });
        step.safety.forEach((line, i) =>
            line.facts.forEach((text, f) => plain(`${at}.safety[${i}].facts[${f}]`, text)),
        );
    });
}
