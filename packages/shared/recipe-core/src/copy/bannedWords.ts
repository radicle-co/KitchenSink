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
 * The matcher compares over `comparisonForm`, the one fold shared with the wording fingerprint. Separators inside an
 * entry are optional (`copyright-free`, `copyright free` and `copyrightfree` are one spelling), an entry may take a
 * plural `s`, and it must stand on word boundaries (so `verified` does not match `unverified`). Cross-script
 * look-alikes are not folded: the list catches wording slips in copy we write, a look-alike letter in a message
 * dictionary is a deliberate act and not that slip, and the shared fold has no confusables table.
 */

import { comparisonForm } from '../comparisonForm.js';
import { escapeRegExp } from '../parsing/escapeRegExp.js';

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

/**
 * Between the parts of an entry: a gap, a minus sign, a hyphen bullet, or nothing at all. `comparisonForm` has already
 * turned every dash into a gap; the minus sign and the hyphen bullet are gaps only here, so the fingerprint fold must
 * not be "aligned" with this class.
 */
const SEPARATOR = '[\\s\\u2212\\u2043]*';

/** The pattern of one entry: its parts joined by optional separators, an optional plural, on word boundaries. */
const patternOf = (word: string): RegExp => {
    const parts = comparisonForm(word).split(/\s+/u).map(escapeRegExp).join(SEPARATOR);

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
    const canonical = comparisonForm(text);

    return MATCHERS.filter(([, matcher]) => matcher.test(canonical)).map(([word]) => word);
}
