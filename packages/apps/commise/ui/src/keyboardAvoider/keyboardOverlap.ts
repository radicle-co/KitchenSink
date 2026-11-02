/**
 * @module @commise/ui/keyboard-lift — the part of a box the keyboard covers.
 *
 * @pattern Policy — one pure rule from two measurements
 */

/**
 * How far a box must rise to clear the keyboard. Pure.
 *
 * @param boxBottom - The box's bottom edge in the window, or `null` before it is measured.
 * @param keyboardTop - The keyboard's top on the screen, or `null` while none is up.
 * @param maxLift - The most the keyboard can cover of the box: its height plus the system bar the box extends under (Android
 *     reports the keyboard's height without the navigation bar). A measurement that says more (a bottom edge read while the
 *     engine's slide transform still applied) is wrong, and lifting by it pushes the panel out of its own frame.
 * @returns `boxBottom - keyboardTop`, at most `maxLift`, and 0 when either is unknown or the keyboard starts below
 *     the box.
 */
export function keyboardOverlap(boxBottom: number | null, keyboardTop: number | null, maxLift: number): number {
    return boxBottom === null || keyboardTop === null ? 0 : Math.min(maxLift, Math.max(0, boxBottom - keyboardTop));
}
