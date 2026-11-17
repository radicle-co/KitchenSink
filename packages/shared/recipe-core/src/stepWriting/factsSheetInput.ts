/**
 * The one input check for a facts sheet's free text.
 *
 * The prompt is facts only, so every string a sheet carries must be a fact: a short plain name, never a sentence of
 * source wording, and a language the writer answers in. Any code that hands a sheet to the writer calls
 * {@link assertFactsSheetPlain} first.
 *
 * Names are plain by construction: normalised to NFC, then made only of what the language's alphabet allows (see
 * `alphabet.ts`), at most {@link MAX_FACT_TEXT_CHARS} code points, and nothing the language's address rule flags. A
 * sentence runs past the length, a link fails the address rule, and markup needs an angle bracket, so none passes.
 *
 * The colon is not in the set. It is the scheme and port marker, and no ingredient name needs it.
 *
 * Product behaviour, fail-closed: a name with a tight dot not on the abbreviation list (`U.S. beef`), or in another
 * script (`梅`, `ঘি`), refuses the whole sheet. The recipe then stays private, and no rewrite is made.
 */
import { ALPHABET_BY_LANGUAGE, isOutputLanguage } from './alphabet.js';
import { firstShapeFault } from './factsSheetShape.js';

import type { OutputLanguage } from './alphabet.js';
import type { FactsSheet } from './factsSheet.types.js';

/** The longest name, unit, action, equipment word or safety fact, in code points. */
export const MAX_FACT_TEXT_CHARS = 80;

/**
 * Whether the text is a plain fact name: short, made only of the language's alphabet, and not an address.
 *
 * @param text - A name, unit, action, equipment word or safety fact.
 * @param language - The output language. Defaults to English.
 * @returns True when it is plain. Pure.
 */
export function isPlainFactText(text: string, language: OutputLanguage = 'en'): boolean {
    const alphabet = ALPHABET_BY_LANGUAGE[language];
    // NFC first, so a decomposed letter composes and passes, and one that cannot compose is not on the list.
    const composed = text.normalize('NFC');

    // Code points, not UTF-16 units: an astral letter is one character of the name.
    return (
        [...composed].length <= MAX_FACT_TEXT_CHARS && alphabet.name.test(composed) && !alphabet.addressRule(composed)
    );
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
    const shapeFault = firstShapeFault(sheet);

    if (shapeFault !== null) {
        throw new FactsSheetInvalidError(shapeFault);
    }

    const language = sheet.language;

    if (!isOutputLanguage(language)) {
        throw new FactsSheetInvalidError('language');
    }

    const plain = (field: string, text: string): void => {
        if (!isPlainFactText(text, language)) {
            throw new FactsSheetInvalidError(field);
        }
    };

    sheet.ingredientNames.forEach((name, i) => plain(`ingredientNames[${i}]`, name));
    sheet.steps.forEach((step, s) => {
        const at = `steps[${s}]`;

        step.actions.forEach((text, i) => plain(`${at}.actions[${i}]`, text));
        step.ingredients.forEach((text, i) => plain(`${at}.ingredients[${i}]`, text));
        step.equipment.forEach((text, i) => plain(`${at}.equipment[${i}]`, text));
        step.amounts.forEach((amount, i) => {
            if (amount.unit !== null) {
                plain(`${at}.amounts[${i}].unit`, amount.unit);
            }
        });
        step.durations.forEach((duration, i) => {
            const min = `${at}.durations[${i}].minSeconds`;
            const max = `${at}.durations[${i}].maxSeconds`;

            if (duration.minSeconds < 0) {
                throw new FactsSheetInvalidError(min);
            }

            if (duration.minSeconds > duration.maxSeconds) {
                throw new FactsSheetInvalidError(max);
            }
        });
        step.safety.forEach((line, i) => {
            line.facts.forEach((text, f) => plain(`${at}.safety[${i}].facts[${f}]`, text));
        });
    });
}
