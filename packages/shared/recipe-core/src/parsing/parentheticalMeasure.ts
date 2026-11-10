/**
 * `readParenthetical` — what a "(...)" directly after a line's leading amount is (owner ruling 2026-11-08, ruling 2).
 *
 * - A **dimension** ("1 (9 inch) double-crust pie pastry", "(9x13 inch)", "(23 cm)") is a NOTE on the food. It is never
 *   the unit: the pie pastry is not measured in inches.
 * - A **package size** ("1 (28 ounce) can", "2 (6.5 ounce) cans") stays part of the unit, word for word as the cook wrote
 *   it, because it is how the cook buys and counts the food.
 *
 * It reads the SOURCE line, not the parse: both parse engines and the merge turn "(9 inch)" into the unit, and the cook's
 * own words are the only place the distinction survives (so a CRF-only line obeys the ruling too). It reads only a
 * parenthetical that follows the leading amount DIRECTLY. "2 cups flour (sifted)" is a preparation, and "1 (about 4
 * cups) pound" is an equivalence, so neither is read.
 *
 * Weight and volume reuse the unit vocabulary (`classifyUnit`); length is {@link LENGTH_UNIT_VOCABULARY}. A weight with no
 * container word after it ("1 (8 ounce) tomato sauce") is left alone: the next word is the food, not a container.
 *
 * Read only by `pastedLineMeasure.ts` (rule 5) and exported from no package entry. Pure.
 *
 * @pattern Parser — parse, don't validate: a closed result type instead of a regex match for the callers to re-read
 */
import { LENGTH_UNIT_VOCABULARY, classifyUnit } from '../units.js';
import { escapeRegExp } from './escapeRegExp.js';

/** What a parenthetical after the amount says. `text` is the text inside the parentheses, as written. */
export type Parenthetical =
    | { readonly kind: 'dimension'; readonly text: string }
    | { readonly kind: 'packageSize'; readonly text: string; readonly container: string };

/**
 * The words that name what a package is: the next word after "(28 ounce)" must be one of these for the parenthetical to
 * be a package size, as written (a plural is a separate spelling).
 */
const CONTAINER_WORDS: ReadonlySet<string> = new Set(
    [
        'can',
        'jar',
        'bottle',
        'box',
        'bag',
        'package',
        'pkg',
        'packet',
        'carton',
        'container',
        'tub',
        'tube',
        'envelope',
        'pouch',
        'tin',
        'block',
        'bar',
        'stick',
        'brick',
        'sachet',
    ].flatMap((word) => [word, `${word}s`, `${word}es`]),
);

const NUMBER = String.raw`\p{Nd}+(?:[.,]\p{Nd}+)?(?:\s+\p{Nd}+/\p{Nd}+|/\p{Nd}+)?`;

/** The leading amount (digits, a fraction, a range) and then the parenthetical, and the word after it. */
const LEADING = new RegExp(
    String.raw`^\s*[\p{Nd}\p{No}][\p{Nd}\p{No}\s/.,–-]*?\s*\(([^()]*)\)(?:\s+([\p{L}][\p{L}-]*))?`,
    'u',
);

const LENGTH_UNITS = LENGTH_UNIT_VOCABULARY.map(escapeRegExp).join('|');

/** "9 inch", "9x13 inch", "9 x 13 inches", "1/2 inch", "9-inch", `9"`. */
const DIMENSION = new RegExp(String.raw`^${NUMBER}(?:\s*(?:x|×|by)\s*${NUMBER})?\s*-?\s*(?:${LENGTH_UNITS})$`, 'iu');

/** "28 ounce", "6.5 ounce", "14 oz", "12 fluid ounce": an amount, then a weight or volume unit. */
const SIZE = new RegExp(String.raw`^${NUMBER}\s*(\p{L}[\p{L}. ]*?)$`, 'u');

/**
 * Read the parenthetical that directly follows the leading amount of a source line.
 *
 * @param sourceLine - The cook's line as written.
 * @returns A dimension, a package size, or `undefined` when there is none or it is neither. Pure.
 */
export function readParenthetical(sourceLine: string): Parenthetical | undefined {
    const found = LEADING.exec(sourceLine);

    if (found === null) {
        return undefined;
    }

    const text = found[1]?.trim() ?? '';

    if (DIMENSION.test(text)) {
        return { kind: 'dimension', text };
    }

    const unit = SIZE.exec(text)?.[1]?.trim();
    const container = found[2];

    if (unit !== undefined && classifyUnit(unit) === 'canonical' && container !== undefined) {
        return CONTAINER_WORDS.has(container.toLowerCase()) ? { kind: 'packageSize', text, container } : undefined;
    }

    return undefined;
}
