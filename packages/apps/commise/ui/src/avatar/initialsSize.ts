/**
 * @module @commise/ui/avatar-initials — how large an avatar's initials are drawn (designer ruling 2026-11-03).
 *
 * Initials do not scale with the system text size. They are 40% of the disc's diameter, rounded down to an even size (the
 * type scale takes even sizes only), so two letters fit at every size and the disc never has to grow: 12 pt in the 32 pt
 * disc, 14 pt in the 36 pt disc, 8 pt in the 20 pt footer disc. The meaning is carried by the name beside the avatar, or
 * by its accessible name.
 *
 * Pure.
 *
 * @pattern Policy — the size of a disc's initials
 */

/** The share of the disc's diameter the initials' size takes. */
export const INITIALS_SHARE = 0.4;

/**
 * The size, in px, the initials in a disc are drawn at.
 *
 * @param discPx - The disc's diameter.
 * @returns 40% of it, rounded down to an even number.
 */
export function initialsPxOf(discPx: number): number {
    return 2 * Math.floor((discPx * INITIALS_SHARE) / 2);
}
