/**
 * @module @commise/ui/sheet — when the sheet treats an on-screen keyboard as open, and when its toolbar collapses
 * (`docs/design/ingredientSpecialization.md` §S8.1).
 *
 * @pattern Specification — pure predicates; the web and native keyboard adapters feed them their platform's reading.
 */

/**
 * The least a keyboard must hide, in px (web) or dp (native), to count as on-screen. A hardware keyboard hides
 * nothing, and an accessory or shortcut bar hides less than this.
 */
export const ON_SCREEN_KEYBOARD_MIN_HEIGHT = 150;

/**
 * Whether an on-screen keyboard is open. Pure.
 *
 * @param obscured - How much of the window the keyboard hides.
 * @param scale - The visual viewport's zoom; anything but 1 is a pinch-zoom, never a keyboard.
 * @returns `true` when at least {@link ON_SCREEN_KEYBOARD_MIN_HEIGHT} is hidden at scale 1.
 */
export function isOnScreenKeyboard(obscured: number, scale = 1): boolean {
    return scale === 1 && obscured >= ON_SCREEN_KEYBOARD_MIN_HEIGHT;
}

/**
 * Whether the toolbar takes the title row's place and the footer hides. Pure.
 *
 * @param keyboardOpen - Whether an on-screen keyboard is open ({@link isOnScreenKeyboard}).
 * @param focusInToolbar - Whether focus is inside the toolbar.
 * @returns `true` only when both hold.
 */
export function isToolbarCollapsed(keyboardOpen: boolean, focusInToolbar: boolean): boolean {
    return keyboardOpen && focusInToolbar;
}
