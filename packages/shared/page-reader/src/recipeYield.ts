/**
 * A recipe's servings, read from schema.org `recipeYield`.
 *
 * `recipeYield` is free text: `4`, `"4"`, `"4 servings"`, `["4", "8 donuts"]`, `"Makes 24 cookies"`, `"4-6"`. Servings are
 * stated only when the FIRST element holds exactly one whole number and no word that says it counts something other than
 * servings. "Makes 24 cookies" says how many cookies, not how many cooks it feeds, and a range names no number, so each
 * leaves servings absent and the item is held for the cook (ADR-0072 §3). Nothing is guessed.
 */
import { recipeServingsSchema } from '@kitchensink/recipe-core';
import { scalar } from './schemaNode.js';

/** The words that may sit beside the number and still mean servings. Every other word means the number counts something else. */
const SERVING_WORDS: ReadonlySet<string> = new Set([
    'serving',
    'servings',
    'serve',
    'serves',
    'people',
    'portion',
    'portions',
]);

/** The longest yield text read. A real one is a few words; a longer text is refused without a scan. */
const MAX_YIELD_CHARS = 200;

/** A whole number written in digits and nothing else, so `4-6`, `4.5` and `1,000` are not one. */
function isWholeNumber(token: string): boolean {
    return token !== '' && [...token].every((char) => char >= '0' && char <= '9');
}

/** The text of the first element of `recipeYield`, or `undefined` when there is none. */
function firstText(value: unknown): string | undefined {
    const first = scalar(value);

    if (typeof first === 'number') {
        return Number.isFinite(first) ? String(first) : undefined;
    }

    return typeof first === 'string' && first.length <= MAX_YIELD_CHARS ? first : undefined;
}

/**
 * Read the servings out of a `recipeYield` value.
 *
 * @param value - The JSON-LD or microdata `recipeYield`: a number, a string, or a list of them (the first is read).
 * @returns A positive whole number within `int4`, or `undefined` when no single number of servings is stated. Pure.
 */
export function servingsOf(value: unknown): number | undefined {
    const text = firstText(value);

    if (text === undefined) {
        return undefined;
    }

    const tokens = text
        .toLowerCase()
        .split(/\s+/u)
        .filter((token) => token !== '');
    const numbers = tokens.filter(isWholeNumber);
    const words = tokens.filter((token) => !isWholeNumber(token));

    if (numbers.length !== 1 || !words.every((word) => SERVING_WORDS.has(word))) {
        return undefined;
    }

    const parsed = recipeServingsSchema.safeParse(Number(numbers[0]));

    return parsed.success ? parsed.data : undefined;
}
