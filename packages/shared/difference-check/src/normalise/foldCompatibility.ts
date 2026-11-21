/**
 * @module @kitchensink/difference-check/normalise: stage 1 of v1 (KTD-2, with staff's 2026-11-21 change): NFKC, then NFD
 * with every mark, format character and default-ignorable code point stripped, then NFC, then lower case.
 *
 * The strip runs BEFORE the tokeniser, so a mark or an invisible character can neither split a word nor disguise one.
 * The cost is accent-insensitive matching, which only helps the check. `\p{Cf}` stays beside the default-ignorable
 * property because some format characters are not default-ignorable (U+0600 to U+0605).
 *
 * Pure.
 */

/** Marks, format characters and default-ignorable code points: everything that is not part of a word's letters. */
const INVISIBLE = /[\p{M}\p{Cf}\p{Default_Ignorable_Code_Point}]/gu;

/** Stage 1a: compatibility forms (full-width letters, ligatures) to their plain letters. */
export function compatibilityFold(text: string): string {
    return text.normalize('NFKC');
}

/** Stage 1b: strip marks, format characters and default-ignorable code points, through NFD and back to NFC. */
export function stripInvisible(text: string): string {
    return text.normalize('NFD').replace(INVISIBLE, '').normalize('NFC');
}

/** Stage 1c: lower case. */
export function lowerCase(text: string): string {
    return text.toLowerCase();
}

/**
 * Stage 1 whole.
 *
 * @param text - Any text.
 * @returns The text with compatibility forms folded, invisible characters and marks stripped, and lower case.
 */
export function foldCompatibility(text: string): string {
    return lowerCase(stripInvisible(compatibilityFold(text)));
}
