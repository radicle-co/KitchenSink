/**
 * @module @commise/ui/keyboard-lift — where the on-screen keyboard is, for the Sheet's lift and the snackbar host.
 *
 * A reader of the ONE keyboard subscription in `layout/useKeyboardShown.native.ts`, so the shown flag and the frame
 * can never disagree about which event they have seen.
 *
 * @pattern Observer — a `useSyncExternalStore` reader of the shared keyboard store
 */
import { useSyncExternalStore } from 'react';

import { keyboardFrameSnapshot, subscribeToKeyboard, type KeyboardFrame } from '../layout/useKeyboardShown.native.js';

/**
 * The keyboard's frame, or `null` while none is up.
 *
 * @sideEffect Listens for keyboard show and hide events while mounted.
 */
export function useKeyboardFrame(): KeyboardFrame | null {
    return useSyncExternalStore(subscribeToKeyboard, keyboardFrameSnapshot, keyboardFrameSnapshot);
}
