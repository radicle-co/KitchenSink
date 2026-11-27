/**
 * The one input check for a facts sheet's free text.
 *
 * The prompt is facts only, so every string a sheet carries must be a fact: a short plain name, never a sentence of
 * source wording, and a language the writer answers in. Any code that hands a sheet to the writer calls
 * {@link toPlainFactsSheet} and sends the sheet it returns.
 *
 * Names are plain by construction: canonical (NFC, spaces folded), then made only of what the language's alphabet
 * allows (see `alphabet.ts`), at most {@link MAX_FACT_TEXT_CHARS} code points, and nothing the language's address
 * rule flags. A sentence runs past the length, a link fails the address rule, and markup needs an angle bracket, so
 * none passes.
 *
 * The colon is not in the set. It is the scheme and port marker, and no ingredient name needs it.
 *
 * What a refused sheet means for the recipe is in `alphabet.ts`.
 */
import { ALPHABET_BY_LANGUAGE, canonicalText, isOutputLanguage } from './alphabet.js';
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
    // Canonical first: a decomposed letter composes and passes, one that cannot compose is not on the list, and other
    // space characters become a plain space.
    const composed = canonicalText(text);

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
 * Parse a sheet into its plain form: the same sheet with every free text in canonical form (see `canonicalText`), or a
 * refusal. The prompt is built from the returned sheet, so what was checked is what is sent.
 *
 * @param sheet - The facts sheet.
 * @returns A copy whose texts are canonical.
 * @throws {FactsSheetInvalidError} On the first field that is not a plain fact. Pure.
 */
export function toPlainFactsSheet(sheet: FactsSheet): FactsSheet {
    const shapeFault = firstShapeFault(sheet);

    if (shapeFault !== null) {
        throw new FactsSheetInvalidError(shapeFault);
    }

    const language = sheet.language;

    if (!isOutputLanguage(language)) {
        throw new FactsSheetInvalidError('language');
    }

    const plain = (field: string, text: string): string => {
        const canonical = canonicalText(text);

        if (!isPlainFactText(canonical, language)) {
            throw new FactsSheetInvalidError(field);
        }

        return canonical;
    };

    return {
        language,
        ingredientNames: sheet.ingredientNames.map((name, i) => plain(`ingredientNames[${i}]`, name)),
        steps: sheet.steps.map((step, s) => {
            const at = `steps[${s}]`;

            return {
                actions: step.actions.map((text, i) => plain(`${at}.actions[${i}]`, text)),
                ingredients: step.ingredients.map((text, i) => plain(`${at}.ingredients[${i}]`, text)),
                equipment: step.equipment.map((text, i) => plain(`${at}.equipment[${i}]`, text)),
                amounts: step.amounts.map((amount, i) => ({
                    quantity: amount.quantity,
                    unit: amount.unit === null ? null : plain(`${at}.amounts[${i}].unit`, amount.unit),
                })),
                temperatures: step.temperatures.map(({ value, scale }) => ({ value, scale })),
                durations: step.durations.map((duration, i) => {
                    if (duration.minSeconds < 0) {
                        throw new FactsSheetInvalidError(`${at}.durations[${i}].minSeconds`);
                    }

                    if (duration.minSeconds > duration.maxSeconds) {
                        throw new FactsSheetInvalidError(`${at}.durations[${i}].maxSeconds`);
                    }

                    return { minSeconds: duration.minSeconds, maxSeconds: duration.maxSeconds };
                }),
                safety: step.safety.map((line, i) => ({
                    category: line.category,
                    facts: line.facts.map((text, f) => plain(`${at}.safety[${i}].facts[${f}]`, text)),
                })),
            };
        }),
    };
}
