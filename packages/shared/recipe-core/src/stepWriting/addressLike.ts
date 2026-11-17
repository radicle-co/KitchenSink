/**
 * The one address detector for step-writing text.
 *
 * A written step and a fact name both refuse anything that reads as a link or an address, so the rule lives here
 * once. It reads raw text and is pure.
 *
 * What counts: a `//`, a URL scheme followed by a colon, a letter followed by a colon and a digit (a host and port), a
 * dotted-quad IPv4 address, and a dot between a letter or digit and a letter, or a letter and a digit (a domain such as
 * `evil.com`, `evil.c0m` or `evil2.com`). The text is first folded with NFKC, so full-width forms become ASCII, and
 * stripped of default-ignorable characters, so a hidden character cannot split a host. An ideographic full stop counts
 * as a dot unless both neighbours are Han, kana or Hangul, where it is a sentence break. A decimal such as `2.5`, a
 * spaced full stop such as `St. Louis`, a time such as `1:30` and a Japanese sentence break are not addresses. The
 * abbreviations `e.g.`, `i.e.`, `a.m.` and `p.m.` are removed before the check, but only when no letter or digit
 * follows them, so `e.g.com` is still a host.
 */

/** Characters Unicode marks as default-ignorable: invisible, and free to sit inside a word. */
const DEFAULT_IGNORABLE = /\p{Default_Ignorable_Code_Point}/gu;

/** The two joiners real scripts need (Persian, Indic). The detector strips them, the plain-text doors allow them. */
const JOINERS = /[‌‍]/u;

const IDEOGRAPHIC_FULL_STOP = '。';

const CJK_CHARACTER = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/** Abbreviations whose dots are not a domain, when nothing word-like follows. */
const ABBREVIATION = /\b(?:e\.g|i\.e|a\.m|p\.m)\.(?![\p{L}\p{N}])/giu;

/** A URL scheme and its colon. */
const SCHEME = /\b(?:javascript|data|vbscript|file|https?|ftp|mailto|blob|tel|sms):/iu;

const ADDRESS = /\/\/|\p{L}:\d|\b\d{1,3}(?:\.\d{1,3}){3}\b|[\p{L}\p{N}]\.\p{L}|\p{L}\.\p{N}/u;

/**
 * Read an ideographic full stop as a dot, unless both neighbours are Han, kana or Hangul.
 *
 * @param text - NFKC-folded text.
 * @returns The text with the disguised dots written as `.`. Pure.
 */
function foldDisguisedDots(text: string): string {
    const characters = [...text];

    return characters
        .map((character, i) => {
            const before = characters[i - 1] ?? '';
            const after = characters[i + 1] ?? '';
            const sentenceBreak = CJK_CHARACTER.test(before) && CJK_CHARACTER.test(after);

            return character === IDEOGRAPHIC_FULL_STOP && !sentenceBreak ? '.' : character;
        })
        .join('');
}

/**
 * Whether the text reads as a link or an address.
 *
 * @param text - Raw text.
 * @returns True when it does. Pure.
 */
export function looksLikeAddress(text: string): boolean {
    const folded = foldDisguisedDots(text.normalize('NFKC').replace(DEFAULT_IGNORABLE, '')).replace(ABBREVIATION, ' ');

    return SCHEME.test(folded) || ADDRESS.test(folded);
}

/**
 * Whether the text holds a default-ignorable character other than the two joiners real scripts need.
 *
 * @param text - Raw text.
 * @returns True when it does. Pure.
 */
export function hasInvisibleCharacter(text: string): boolean {
    return text.replace(JOINERS, '').search(DEFAULT_IGNORABLE) !== -1;
}
