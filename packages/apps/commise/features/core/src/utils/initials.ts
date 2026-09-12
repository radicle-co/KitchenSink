/**
 * @module @commise/features-core — viewer initials for the Home avatar (Home chrome).
 *
 * Shared, pure, and platform-agnostic: the web top bar and the native top bar must derive the SAME initials
 * from the SAME profile, so this is not forked per app.
 */

/**
 * A word's leading LETTER together with the combining marks that belong to it (`E` + U+0301 is one É).
 *
 * ⚠️ Deliberately a letter match, not a code-point or grapheme slice. A code point splits a flag (two regional
 * indicators) and a ZWJ emoji sequence; a grapheme slice would keep them whole but still emit `(` for
 * `(she/her)`. An initial is a letter, so a word that does not START with one contributes nothing.
 *
 * ⛔ Not `Intl.Segmenter`: Hermes does not ship it, and this module runs on mobile. Unicode property escapes
 * are compiled by `hermesc` (verified against the repo's `hermes-compiler` binary).
 */
const LEADING_LETTER = /^\p{L}\p{M}*/u;

/**
 * Derive the avatar initials for a display name — the leading letter of the first and of the last word that
 * starts with a letter (the mockup's "JD").
 *
 * Words that do not start with a letter are not name parts and are skipped: an emoji or flag in front of the
 * name, a trailing `(she/her)`, a quoted `"Bob"`. Names are user data from Clerk and are not guaranteed
 * ASCII, so the letter is matched by Unicode category — CJK, astral-plane and decomposed letters all count.
 *
 * An absent, empty, whitespace-only or letterless name yields `''` — the caller decides what to draw instead
 * (a name-less viewer is a real state: Clerk accounts created by email have no name until the user sets one).
 *
 * @param displayName - The viewer's display name, if known.
 * @returns One or two upper-cased initials, or `''` when no letter can be derived. Pure.
 */
export function initialsFor(displayName: string | undefined): string {
    const letters = (displayName ?? '')
        .trim()
        .split(/\s+/u)
        .map((word) => LEADING_LETTER.exec(word)?.[0])
        .filter((letter): letter is string => letter !== undefined);

    const first = letters[0];

    if (first === undefined) {
        return '';
    }

    const last = letters.length > 1 ? letters[letters.length - 1] : '';

    return `${first}${last}`.toUpperCase();
}
