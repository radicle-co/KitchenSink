/**
 * @module @commise/ui/layout — whether the native on-screen keyboard is shown. The sheet and the screen frames read it
 * (`docs/design/compactHeightLayout.md` §2); the frame itself is read from the one keyboard store in
 * `./keyboardStore.native.ts`.
 *
 * Shown only while the keyboard is at least as tall as `ON_SCREEN_KEYBOARD_MIN_HEIGHT`, so an iPad shortcut bar or a
 * hardware keyboard's accessory bar never collapses the sheet or a screen frame.
 *
 * @pattern Observer — a `useSyncExternalStore` reader of the shared keyboard store; the rule is `isOnScreenKeyboard`
 */
import { useSyncExternalStore } from 'react';

import { isOnScreenKeyboard } from '../sheet/onScreenKeyboard.js';
import { keyboardFrameSnapshot, subscribeToKeyboard } from './keyboardStore.native.js';

/** Whether an on-screen keyboard is open now. A boolean, so a read twice gives the same value. */
function shownSnapshot(): boolean {
    const frame = keyboardFrameSnapshot();

    return frame !== null && isOnScreenKeyboard(frame.height);
}

/**
 * Whether an on-screen keyboard is open.
 *
 * @returns `true` while a keyboard at least 150 dp tall is showing or about to show.
 * @sideEffect Listens for keyboard show and hide events while mounted.
 */
export function useKeyboardShown(): boolean {
    return useSyncExternalStore(subscribeToKeyboard, shownSnapshot, shownSnapshot);
}
