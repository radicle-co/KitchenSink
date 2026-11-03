/**
 * @module @commise/ui/text — where the cover letter's cap band sits in its own line, so the native cover can
 * centre the capital and not the line (designer ruling, 2026-11-03: within 2 pt on both axes, at every scale).
 *
 * The figures are Manrope Bold's own, read from `Manrope_700Bold.ttf` (2000 units per em): ascent 2132, descent 600, cap
 * height 1440. The hhea, typo and win tables agree, so iOS and Android read the same line. A line exactly as tall as the
 * font (no leading, no font padding) puts the baseline `ascent` below its top and the middle of the capitals
 * `ascent − capHeight / 2` below it; the middle of the line is `(ascent + descent) / 2`. The capitals therefore sit
 * {@link CAP_BAND_DROP_EM} below the middle, and the letter is lifted by that much.
 *
 * Pure.
 */
const UNITS_PER_EM = 2000;
const ASCENT = 2132 / UNITS_PER_EM;
const DESCENT = 600 / UNITS_PER_EM;
const CAP_HEIGHT = 1440 / UNITS_PER_EM;

/** How far the middle of the capitals sits below the middle of the font's own line, in em. */
export const CAP_BAND_DROP_EM = (ASCENT - DESCENT) / 2 - CAP_HEIGHT / 2;

/**
 * The letter's line height: the font's own height, so neither platform adds leading around it. Pure.
 *
 * @param fontSize - The letter's size in points.
 * @returns The line height in points.
 */
export function letterLineHeightOf(fontSize: number): number {
    return Math.round((ASCENT + DESCENT) * fontSize);
}

/**
 * How far to lift the letter so the middle of its capitals is the middle of its box. Pure.
 *
 * @param fontSize - The letter's size in points.
 * @returns The lift in points.
 */
export function letterLiftOf(fontSize: number): number {
    return CAP_BAND_DROP_EM * fontSize;
}
