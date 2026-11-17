/**
 * The output language's alphabet: what a fact name and a written step may be made of, and the address rule that goes
 * with it.
 *
 * @pattern Strategy (Registry): `ALPHABET_BY_LANGUAGE` maps each output language to its own allowlists and its own
 * address rule. It is a `Record` over the closed `OutputLanguage` union, so adding a language fails to compile until
 * that language has an `Alphabet` entry and an entry in the unit tests' table of cases. How the entry treats the
 * ideographic full stop (`。`) is for its author and that table to settle: the compiler does not check it.
 *
 * Both doors, the sheet check and the answer reader, normalise to NFC, fold every space character to a plain space
 * (see {@link canonicalText}), and then accept only what the allowlist names, with at least one letter or digit.
 * For English that is a to z, a closed list of accented letters, the digits 0 to 9, the vulgar fractions, and the
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
 * What a plain name may hold besides letters and digits: space, apostrophes and the single curly quotes, comma,
 * parentheses, ampersand, percent, degree, full stop, plus, slash, number sign, multiplication sign, ellipsis,
 * registered and trade mark signs, degree Celsius, and hyphen. The hyphen stays last so the set reads as a regex class.
 * Other space characters are folded to a plain space before the check, not allowed as characters.
 */
export const PLAIN_FACT_PUNCTUATION = " '\u2019\u2018,()&%\u00B0.+/#\u00D7\u2026\u00AE\u2122\u2103-";

/**
 * What a written step may hold besides letters and digits: the name set, plus semicolon, colon, exclamation and
 * question marks, double quotes and dashes.
 */
const PLAIN_PROSE_PUNCTUATION =
    ' .,;:!?\'\u2019\u2018"\u201C\u201D()-\u2013\u2014/%\u00B0&+#\u00D7\u2026\u00AE\u2122\u2103';

/**
 * The accented Latin letters English recipe text really uses (French, Spanish, Portuguese, German, Scandinavian and
 * Italian loan words), in both cases, as precomposed characters. The list is closed on purpose: `\p{Script=Latin}`
 * also admits look-alikes of plain letters (dotless i, long s, iota, small capitals), which would let a hidden
 * character pass as a letter. A decomposed letter composes under NFC and so passes. Add a letter here only with a test.
 */
const ENGLISH_ACCENTED_LETTERS =
    '\u00E0\u00E1\u00E2\u00E3\u00E4\u00E5\u00E6\u00E7\u00E8\u00E9\u00EA\u00EB\u00EC\u00ED\u00EE\u00EF\u00F1\u00F2\u00F3\u00F4\u00F5\u00F6\u00F8\u00F9\u00FA\u00FB\u00FC\u00FD\u00FF\u00DF\u00C0\u00C1\u00C2\u00C3\u00C4\u00C5\u00C6\u00C7\u00C8\u00C9\u00CA\u00CB\u00CC\u00CD\u00CE\u00CF\u00D1\u00D2\u00D3\u00D4\u00D5\u00D6\u00D8\u00D9\u00DA\u00DB\u00DC\u00DD\u0153\u0152\u0178';

/** The English letters: a to z, A to Z, and the closed accented list. */
const LATIN_LETTER = `a-zA-Z${ENGLISH_ACCENTED_LETTERS}`;

/** The digits 0 to 9 and the vulgar fractions U+00BC to U+00BE and U+2150 to U+215E. */
const DIGIT_OR_FRACTION = '0-9\\u00BC-\\u00BE\\u2150-\\u215E';

/**
 * A set of characters as the inside of a `v`-flag class: each syntax character is escaped.
 *
 * @param characters - The characters, literally.
 * @returns The escaped class body. Pure.
 */
const classBody = (characters: string): string => characters.replace(/[()[\]{}/|\\-]/gu, String.raw`\$&`);

/** Somewhere in the text there is a letter, a digit or a fraction, so punctuation alone is never a name or a step. */
const SOMETHING_TO_READ = `(?=.*[${LATIN_LETTER}${DIGIT_OR_FRACTION}])`;

/** A name starts with a letter, digit, fraction, apostrophe or number sign (`'nduja`, `#2 can`), then holds only the name set. */
const ENGLISH_NAME = new RegExp(
    `^${SOMETHING_TO_READ}[${LATIN_LETTER}${DIGIT_OR_FRACTION}'\u2019\u2018#][${LATIN_LETTER}${DIGIT_OR_FRACTION}${classBody(PLAIN_FACT_PUNCTUATION)}]*$`,
    'v',
);

const ENGLISH_PROSE = new RegExp(
    `^${SOMETHING_TO_READ}[${LATIN_LETTER}${DIGIT_OR_FRACTION}${classBody(PLAIN_PROSE_PUNCTUATION)}]+$`,
    'v',
);

/**
 * The text a door checks and hands back: NFC, so a decomposed letter composes, with every space character (no-break,
 * em, ideographic and the rest of `\p{Zs}`) folded to a plain space. Spaces are folded, not allowed as characters.
 *
 * @param text - Raw text.
 * @returns The canonical text. Pure.
 */
export function canonicalText(text: string): string {
    return text.normalize('NFC').replace(/\p{Zs}/gu, ' ');
}

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
