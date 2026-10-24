/**
 * @module @commise/ui/layout — whether the window is compact in height, and when the screen frames step aside for the
 * keyboard (`docs/design/compactHeightLayout.md` §2).
 *
 * Android's window size classes call a window under 480 dp tall compact ("Use window size classes",
 * developer.android.com): every phone held sideways is, and no phone or tablet held upright is. The screen frames
 * lay out differently in compact height, and only when compact AND a keyboard is open do they put their chrome away.
 *
 * ⛔ Keyed on the WINDOW, never on the height left above the keyboard: a layout that changed when the keyboard opened
 * could remount the focused field, which closes the keyboard, which changes the layout back. The keyboard is its own
 * input.
 *
 * @pattern Specification — pure predicates over the window height and the keyboard's presence.
 */

/** Below this window height, in dp, the window is compact in height. */
export const COMPACT_HEIGHT_BELOW_DP = 480;

/**
 * Whether the window is compact in height. Pure.
 *
 * @param windowHeight - The window's height, in dp.
 * @returns `true` strictly below {@link COMPACT_HEIGHT_BELOW_DP}, as Material states the class.
 */
export function isCompactHeight(windowHeight: number): boolean {
    return windowHeight < COMPACT_HEIGHT_BELOW_DP;
}

/**
 * Whether a screen frame puts its chrome away for the keyboard. Pure.
 *
 * @param compactHeight - Whether the window is compact in height ({@link isCompactHeight}).
 * @param keyboardOpen - Whether an on-screen keyboard is open.
 * @returns `true` only when both hold: held upright, the keyboard leaves room, and hiding chrome would buy nothing.
 */
export function isFrameCollapsed(compactHeight: boolean, keyboardOpen: boolean): boolean {
    return compactHeight && keyboardOpen;
}
