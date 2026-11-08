/**
 * @module @commise/features-recipes/format — the circle a step numeral sits in (designer ruling 2026-11-03).
 *
 * A step numeral caps at 1.5x, like chrome. Its circle is at least {@link NUMERAL_DISC_MIN} pt and grows to the numeral's
 * line height plus 8, so two digits always fit. The cap is the design-system Text's `chromeCap="1.5"`, which this reads
 * the same way (`scaledTypeSize`).
 *
 * Pure.
 *
 * @pattern Policy — the size of a numeral's circle
 */
import { scaledTypeSize } from '@commise/ui/scaled-type';

/** The smallest the circle is, in pt. */
export const NUMERAL_DISC_MIN = 32;

/** What the circle adds to the numeral's line height, in pt. */
const NUMERAL_DISC_PADDING = 8;

/**
 * The diameter of a step numeral's circle.
 *
 * @param role - The numeral's type role.
 * @param fontScale - The system font scale (`useWindowDimensions().fontScale`).
 * @returns The diameter in pt, never below {@link NUMERAL_DISC_MIN}.
 */
export function numeralDiscOf(role: 'caption' | 'label', fontScale: number): number {
    return Math.max(NUMERAL_DISC_MIN, scaledTypeSize(role, fontScale, '1.5').lineHeight + NUMERAL_DISC_PADDING);
}
