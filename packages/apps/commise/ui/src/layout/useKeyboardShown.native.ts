/**
 * @module @commise/ui/layout — the native reading of an on-screen keyboard, shared by the sheet and the screen frames
 * (`docs/design/compactHeightLayout.md` §2).
 *
 * Shown only while React Native reports a visible keyboard at least as tall as `ON_SCREEN_KEYBOARD_MIN_HEIGHT`, so
 * an iPad shortcut bar or a hardware keyboard's accessory bar never collapses the sheet or a screen frame.
 *
 * @pattern Adapter over React Native's `Keyboard` — `useSyncExternalStore` is the subscription (Observer); the rule
 *     is `isOnScreenKeyboard`.
 */
import { useSyncExternalStore } from 'react';
import { Keyboard } from 'react-native';

import { isOnScreenKeyboard } from '../sheet/onScreenKeyboard.js';

/** Re-read after the keyboard shows or hides. */
function subscribe(onChange: () => void): () => void {
    const shown = Keyboard.addListener('keyboardDidShow', onChange);
    const hidden = Keyboard.addListener('keyboardDidHide', onChange);

    return () => {
        shown.remove();
        hidden.remove();
    };
}

/** Whether an on-screen keyboard is open now. */
function snapshot(): boolean {
    return Keyboard.isVisible() && isOnScreenKeyboard(Keyboard.metrics()?.height ?? 0);
}

/**
 * Whether an on-screen keyboard is open.
 *
 * @returns `true` while a keyboard at least 150 dp tall is visible.
 * @sideEffect Listens for keyboard show and hide events while mounted.
 */
export function useKeyboardShown(): boolean {
    return useSyncExternalStore(subscribe, snapshot, snapshot);
}
