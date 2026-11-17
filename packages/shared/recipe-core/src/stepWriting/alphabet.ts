/**
 * The output language's alphabet: what a fact name and a written step may be made of, and the address rule that goes
 * with it.
 *
 * @pattern Strategy (Registry): `ALPHABET_BY_LANGUAGE` maps each output language to its own allowlists and its own
 * address rule. It is a `Record` over the closed `OutputLanguage` union, so adding a language fails to compile until
 * that language has an alphabet, its own handling of the ideographic full stop (`。`), and, in the unit tests, its own
 * table of refused and accepted cases.
 *
 * Both doors, the sheet check and the answer reader, normalise to NFC and then accept only what the allowlist names.
 * For English that is Latin letters (not full-width ones), the digits 0 to 9, the vulgar fractions, and the
 * punctuation sets below. Combining marks, other scripts, full-width forms, joiners and hidden characters are not in it.
 * A decomposed `é` composes under NFC and passes. A combining mark that does not compose has no place to hide, because
 * it is not on the list.
 *
 * The address rule, and why it is not a link-detection library, is in `addressLike.ts`.
 *
 * Product behaviour, fail-closed: a name that holds a tight dot not on the abbreviation list (`U.S. beef`), or an
 * ingredient name in another script (`梅`, `ঘি`), refuses the whole sheet. The recipe then stays private, and no
 * rewrite is made.
 *
 * Node-only: the `v` flag needs ES2024, and the engine runs in the worker, not in an app.
 */
import { looksLikeAddress } from './addressLike.js';

/** The languages the step writer answers in. A closed union: add a member here and the registry must follow. */
export const OUTPUT_LANGUAGES = ['en'] as const;

/** A language the step writer answers in. */
export type OutputLanguage = (typeof OUTPUT_LANGUAGES)[number];

/**
 * Whether a value is an output language.
 *
 * @param value - Any value, such as the language of a sheet read back from storage.
 * @returns True when it is one of {@link OUTPUT_LANGUAGES}. Pure.
 */
export function isOutputLanguage(value: unknown): value is OutputLanguage {
    return OUTPUT_LANGUAGES.some((language) => language === value);
}

/**
 * What a plain name may hold besides letters and digits: space, apostrophes, comma, parentheses, ampersand, percent,
 * degree, full stop, plus, slash and hyphen. The hyphen stays last so the set reads as a regex class.
 */
export const PLAIN_FACT_PUNCTUATION = " '’,()&%°.+/-";

/** What a written step may hold besides letters and digits: the name set, plus semicolon, colon, marks, quotes and dashes. */
const PLAIN_PROSE_PUNCTUATION = ' .,;:!?\'’"“”()-–—/%°&+';

/** Latin letters, minus the full-width block, which `\p{Script=Latin}` includes. */
const LATIN_LETTER = '[\\p{Script=Latin}--[\\uFF00-\\uFFEF]]';

/** The digits 0 to 9 and the vulgar fractions U+00BC to U+00BE and U+2150 to U+215E. */
const DIGIT_OR_FRACTION = '0-9\\u00BC-\\u00BE\\u2150-\\u215E';

/**
 * A set of characters as the inside of a `v`-flag class: each syntax character is escaped.
 *
 * @param characters - The characters, literally.
 * @returns The escaped class body. Pure.
 */
const classBody = (characters: string): string => characters.replace(/[()[\]{}/|\\-]/gu, String.raw`\$&`);

/** A name starts with a letter, digit, fraction or apostrophe (`'nduja`), then holds only the name set. */
const ENGLISH_NAME = new RegExp(
    `^[${LATIN_LETTER}${DIGIT_OR_FRACTION}'’][${LATIN_LETTER}${DIGIT_OR_FRACTION}${classBody(PLAIN_FACT_PUNCTUATION)}]*$`,
    'v',
);

const ENGLISH_PROSE = new RegExp(`^[${LATIN_LETTER}${DIGIT_OR_FRACTION}${classBody(PLAIN_PROSE_PUNCTUATION)}]+$`, 'v');

/** One language's alphabet. */
export interface Alphabet {
    /** What a fact name may be made of. */
    readonly name: RegExp;
    /** What a written step may be made of. */
    readonly prose: RegExp;
    /** Whether the text reads as a link or an address, in this language's writing. */
    readonly addressRule: (text: string) => boolean;
}

/** Each output language's alphabet. English has no `。` in it, so the full stop is refused by the allowlist itself. */
export const ALPHABET_BY_LANGUAGE: Record<OutputLanguage, Alphabet> = {
    en: { name: ENGLISH_NAME, prose: ENGLISH_PROSE, addressRule: looksLikeAddress },
};
