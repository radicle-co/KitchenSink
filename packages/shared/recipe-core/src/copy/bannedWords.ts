/**
 * THE ONE BANNED-WORD LIST for cook-facing copy about rights and rewriting.
 *
 * DESIGN PATTERN: **single source of truth + shared matcher.** The list is held here once, and every copy guard
 * imports it and the matcher beside it, so no guard keeps a private copy of the words or its own idea of what
 * counts as a match.
 *
 * The words claim a check or a clearance that did not happen. Copy says what the cook told us and what Commise's own
 * rule is, never that a site, a recipe or a right was checked. English only at launch; per-locale lists come with the
 * second language.
 *
 * The matcher compares the package's text canonical form (`sanitizeFoodName`: NFKC, invisible characters and the
 * soft hyphen removed), then folds every dash to a space, lower-cases, strips accents (NFD, combining marks out) and
 * folds the Latin look-alikes the list's letters need (see {@link LOOKALIKES}). Separators inside an entry are optional
 * (`copyright-free`, `copyright free` and `copyrightfree` are one spelling), an entry may take a plural `s`, and it
 * must stand on word boundaries (so `verified` does not match `unverified`).
 *
 * INTERIM: the look-alike table is small and explicit, and it is pending one shared comparison fold, which this
 * matcher is to adopt in its place.
 */

import { escapeRegExp } from '../parsing/escapeRegExp.js';
import { sanitizeFoodName } from '../foodName.js';

/** Words and phrases no cook-facing rights or rewriting string may use. */
export const BANNED_COPY_WORDS: readonly string[] = [
    'copyright-free',
    'royalty-free recipe',
    'legally yours',
    'safe to publish',
    'we checked this',
    'verified',
    'approved',
];

const WORD_CHARACTER = '\\p{L}\\p{N}';

/** Dashes and minus signs: `\p{Pd}` (U+2010 to U+2015 among them), the minus sign, the superscript minus and the
 * hyphen bullet. */
const DASHES = /[\p{Pd}\u2212\u207B\u2043]/gu;

/**
 * Non-Latin letters (already lower case) that look like the Latin letters this list is written in. Cyrillic, Greek,
 * and the dotless i and its look-alikes.
 */
const LOOKALIKES: Readonly<Record<string, string>> = {
    '\u0430': 'a',
    '\u0441': 'c',
    '\u0435': 'e',
    '\u043E': 'o',
    '\u0440': 'p',
    '\u0443': 'y',
    '\u0456': 'i',
    '\u04CF': 'i',
    '\u0455': 's',
    '\u0458': 'j',
    '\u04BB': 'h',
    '\u0501': 'd',
    '\u051D': 'w',
    '\u0475': 'v',
    '\u043A': 'k',
    '\u0131': 'i',
    '\u0269': 'i',
    '\u03B9': 'i',
    '\u03BF': 'o',
    '\u03BD': 'v',
    '\u03C1': 'p',
    '\u03B1': 'a',
    '\u03C5': 'u',
    '\u03BA': 'k',
    '\u0261': 'g',
};

const LOOKALIKE_LETTERS = new RegExp(`[${Object.keys(LOOKALIKES).join('')}]`, 'gu');

/**
 * The comparison form of a string: canonical form, then dashes to spaces, lower case, accents out, look-alikes folded.
 * The dash fold runs after NFKC, which maps some dashes (the superscript minus) to others.
 */
const foldedOf = (text: string): string =>
    sanitizeFoodName(text)
        .replace(DASHES, ' ')
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .replace(LOOKALIKE_LETTERS, (letter) => LOOKALIKES[letter] ?? letter)
        .replace(/\s+/gu, ' ')
        .trim();

/** The pattern of one entry: its parts joined by optional separators, an optional plural, on word boundaries. */
const patternOf = (word: string): RegExp => {
    const parts = foldedOf(word).split(' ').map(escapeRegExp).join('\\s*');

    return new RegExp(`(?<![${WORD_CHARACTER}])${parts}s?(?![${WORD_CHARACTER}])`, 'u');
};

const MATCHERS: readonly (readonly [string, RegExp])[] = BANNED_COPY_WORDS.map((word) => [word, patternOf(word)]);

/**
 * The banned words found in `text`, in list order, each once.
 *
 * @param text - One user-facing string.
 * @returns The matching entries of {@link BANNED_COPY_WORDS}. Pure.
 */
export function bannedCopyWordsIn(text: string): string[] {
    const canonical = foldedOf(text);

    return MATCHERS.filter(([, matcher]) => matcher.test(canonical)).map(([word]) => word);
}
