/**
 * @module @commise/ui/chip — the chip's label rule (spec §1.11): a label of more than 24 visible characters shows its
 * first 23 and an ellipsis, and the full label stays the chip's accessible name (SC 2.5.3: the visible text is
 * contained in the name).
 *
 * "Visible characters" are counted by code point (`Array.from`), so an emoji or an accented letter written as one code
 * point counts once and is never cut in half. A grapheme made of several code points (a flag) may be counted more than
 * once; a chip label is a facet or a tag name, so that is accepted rather than paying for a segmenter that Hermes does
 * not ship.
 */

/** The most characters a chip shows. */
export const CHIP_LABEL_LIMIT = 24;

/**
 * The text a chip shows for a label. Pure.
 *
 * @param label - The full label.
 * @returns The label itself when it fits, else its first 23 characters and `…`.
 */
export function visibleChipLabel(label: string): string {
    const characters = Array.from(label);

    if (characters.length <= CHIP_LABEL_LIMIT) {
        return label;
    }

    return `${characters.slice(0, CHIP_LABEL_LIMIT - 1).join('')}…`;
}
