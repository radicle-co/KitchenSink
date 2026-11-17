/**
 * THE COMPARISON FORM: the one fold both sides of a wording comparison pass through before shingling.
 *
 * DESIGN PATTERN: **canonical form (normaliser).** Text the cook types reaches the similarity check without passing
 * the answer door, so the fold runs on the source side AND the written side, and every stored fingerprint means
 * "the shingles of this form". It is pure and has one owner: the shingler and every other comparison read it here.
 *
 * The steps, in order:
 *
 * 0. An apostrophe-like character that NFKC would turn into a space plus a mark becomes an ASCII apostrophe. Checked
 *    one by one with `normalize('NFKC')`, three do: U+00B4 acute accent (to a space and U+0301), U+1FBF Greek psili
 *    (to a space and U+0313) and U+1FFE Greek dasia (to a space and U+0314). Left alone, "don´t" would split into
 *    "don t". The other candidates need no step 0: U+FF07 maps to an ASCII apostrophe in NFKC, U+1FEF and U+FF40
 *    map to the grave accent, and U+02B9, U+02BB, U+02BC, U+02BD, U+02C8, U+0060, U+2018, U+2019, U+201B, U+2032 and
 *    U+2035 do not decompose at all.
 * 1. NFKC.
 * 2. The Hangul fillers (U+115F, U+1160, U+3164, U+FFA0), `\p{Z}`, `\p{Cc}` and `\p{Pd}` become a space. The fillers
 *    are also default-ignorable, so this must run before step 3 or two words would join.
 * 3. Every other Default_Ignorable_Code_Point is removed, the soft hyphen included.
 * 4. Lower case.
 * 5. NFD, then every `\p{M}` is removed (accents go; a lone mark goes).
 * 6. Apostrophes are removed: ' U+2019 U+2018 U+02BC and the grave accent. U+00B4 is not listed: step 0 has already
 *    turned it into an apostrophe, and after NFKC it would be a space plus a mark.
 *
 * Whitespace is NOT collapsed: the shingler splits on whitespace runs.
 *
 * NOT folded, by design: look-alike letters of another script (a Cyrillic а, a Greek ο, the dotless ı). The language
 * allowlist refuses mixed-script and non-Latin text upstream, so this fold spends no confusables table on it. Stripping
 * marks is lossy for scripts that carry vowels in marks; that too is outside the allowlisted languages.
 *
 * Any change to this fold changes what a stored fingerprint means and needs a new `FINGERPRINT_FORMAT_VERSION`.
 */

/** U+00B4, U+1FBF and U+1FFE: apostrophe-likes whose NFKC form is a space plus a mark. */
const SPACING_APOSTROPHES = /[\u{B4}\u{1FBF}\u{1FFE}]/gu;

/** The Hangul fillers, any separator, any control and any dash: all a word gap. */
const SEPARATORS = /[\u{115F}\u{1160}\u{3164}\u{FFA0}\p{Z}\p{Cc}\p{Pd}]/gu;

const IGNORABLE = /\p{Default_Ignorable_Code_Point}/gu;

const MARKS = /\p{M}/gu;

const APOSTROPHES = /['\u{2019}\u{2018}\u{2BC}`]/gu;

/**
 * The comparison form of `text`.
 *
 * @param text - Any text.
 * @returns The folded text, with whitespace runs left as they are. Pure.
 */
export function comparisonForm(text: string): string {
    return text
        .replace(SPACING_APOSTROPHES, "'")
        .normalize('NFKC')
        .replace(SEPARATORS, ' ')
        .replace(IGNORABLE, '')
        .toLowerCase()
        .normalize('NFD')
        .replace(MARKS, '')
        .replace(APOSTROPHES, '');
}
