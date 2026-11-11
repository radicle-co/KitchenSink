/**
 * @module @commise/ui/avatar-initials — how large an avatar's initials are drawn: the ONE authority (designer rulings
 * 2026-11-03 and 2026-11-11).
 *
 * Initials do not scale with the system text size. They are 40% of the disc's diameter, rounded down to an even size (the
 * type scale takes even sizes only), so two letters fit at every size and the disc never has to grow: 12 in the 32 disc, 8 in
 * the 20 footer disc. A disc of {@link INITIALS_FLOOR_FROM_PX} or more also has a floor of {@link INITIALS_MIN_PX}: the 24 tab
 * glyph answers 10, where 40% alone would make 8, too small to read. The 20 footer disc is below it and keeps 8. The meaning is
 * carried by the name beside the avatar, or by its accessible name.
 *
 * Pure.
 *
 * @pattern Policy — the size of a disc's initials
 */

/** The share of the disc's diameter the initials' size takes. */
export const INITIALS_SHARE = 0.4;

/** The smallest the initials are drawn in a disc the floor applies to: 10, so the 24 tab glyph is legible. */
export const INITIALS_MIN_PX = 10;

/** The smallest disc the floor applies to. Below it (the 20 footer disc) the 40% rule alone stands. */
export const INITIALS_FLOOR_FROM_PX = 24;

/**
 * The size, in px, the initials in a disc are drawn at.
 *
 * @param discPx - The disc's diameter.
 * @returns 40% of it, rounded down to an even number, and for a disc of {@link INITIALS_FLOOR_FROM_PX} or more at least
 *     {@link INITIALS_MIN_PX}.
 */
export function initialsPxOf(discPx: number): number {
    const share = 2 * Math.floor((discPx * INITIALS_SHARE) / 2);

    return discPx >= INITIALS_FLOOR_FROM_PX ? Math.max(INITIALS_MIN_PX, share) : share;
}
