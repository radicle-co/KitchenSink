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

/** A reader that is switched off holds no listener and sees no keyboard. */
const noSubscription = (): (() => void) => () => undefined;
const noFrame = (): null => null;

/**
 * The keyboard's frame, or `null` while none is up.
 *
 * @param active - Whether to read at all. A reader that is off adds no listener, so a host that is always mounted but needs
 *     the keyboard only now and then does not keep the shared listeners alive for the life of the app. Defaults to on.
 * @sideEffect Listens for keyboard show and hide events while mounted and active.
 */
export function useKeyboardFrame(active = true): KeyboardFrame | null {
    return useSyncExternalStore(
        active ? subscribeToKeyboard : noSubscription,
        active ? keyboardFrameSnapshot : noFrame,
        active ? keyboardFrameSnapshot : noFrame,
    );
}
