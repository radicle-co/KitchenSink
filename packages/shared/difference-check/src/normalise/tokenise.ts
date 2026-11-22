/**
 * @module @kitchensink/difference-check/normalise: stage 2 of v1 (KTD-2): split into tokens.
 *
 * A token is a run of letters and digits. A number written with a decimal point, a fraction slash or a range dash stays ONE
 * token (`1.5`, `1/2`, `2-3`), because the fold after it must see one number, and a number keeps the letters that follow
 * it (`180c`, `20cm`, `0nion`) for the fold to split or the skeleton to read. A comma or a dash between two WORDS joins
 * nothing.
 *
 * Pure.
 */

/** A number with its separators and any letters after it, or else a run of letters and digits. */
const TOKEN = /\p{N}+(?:[.,/⁄\-–—−]\p{N}+)*[\p{L}\p{N}]*|[\p{L}\p{N}]+/gu;

/**
 * Stage 2.
 *
 * @param text - Text from stage 1.
 * @returns The tokens in order, empty for text with no letter or digit.
 */
export function tokenise(text: string): string[] {
    return text.match(TOKEN) ?? [];
}
