/**
 * @module @commise/ui/layout — the native reading of an on-screen keyboard, shared by the sheet and the screen frames
 * (`docs/design/compactHeightLayout.md` §2).
 *
 * Shown only while the keyboard is at least as tall as `ON_SCREEN_KEYBOARD_MIN_HEIGHT`, so an iPad shortcut bar or a
 * hardware keyboard's accessory bar never collapses the sheet or a screen frame.
 *
 * It follows the same moment as the keyboard avoider's padding. On iOS that is `keyboardWillShow` and
 * `keyboardWillHide`, and the state comes from the event's own `endCoordinates.height`, because `Keyboard.isVisible()`
 * and `Keyboard.metrics()` change only on `keyboardDidShow` and would still read the old keyboard. Android sends only
 * the Did events, so it reads React Native's own state after them.
 *
 * @pattern Adapter over React Native's `Keyboard` — `useSyncExternalStore` is the subscription (Observer); the rule
 *     is `isOnScreenKeyboard`.
 */
import { useSyncExternalStore } from 'react';
import { Keyboard, Platform, type KeyboardEvent } from 'react-native';

import { isOnScreenKeyboard } from '../sheet/onScreenKeyboard.js';

/** What the last Will event said, or `null` when there is none to trust (no hook mounted, or Android). */
let reported: boolean | null = null;
const watchers = new Set<() => void>();
let removers: readonly (() => void)[] = [];

/** React Native's own state: right after a Did event, and the start before any event. */
function platformReading(): boolean {
    return Keyboard.isVisible() && isOnScreenKeyboard(Keyboard.metrics()?.height ?? 0);
}

/** Tell every mounted hook to read again. */
function notify(): void {
    watchers.forEach((watcher) => {
        watcher();
    });
}

/**
 * Start listening: iOS for the Will events, whose event carries the keyboard's end height, and every other platform
 * for the Did events, which React Native's own state has caught up with.
 *
 * @sideEffect Adds the keyboard listeners.
 */
function listen(): void {
    if (Platform.OS === 'ios') {
        const shown = Keyboard.addListener('keyboardWillShow', (event: KeyboardEvent) => {
            reported = isOnScreenKeyboard(event.endCoordinates.height);
            notify();
        });
        const hidden = Keyboard.addListener('keyboardWillHide', () => {
            reported = false;
            notify();
        });

        removers = [() => shown.remove(), () => hidden.remove()];

        return;
    }

    const shown = Keyboard.addListener('keyboardDidShow', notify);
    const hidden = Keyboard.addListener('keyboardDidHide', notify);

    removers = [() => shown.remove(), () => hidden.remove()];
}

/**
 * One pair of listeners serves every mounted hook. The last one to leave removes them and forgets the report, so a
 * hook that mounts later reads React Native's state and not an event it missed.
 *
 * @sideEffect Adds and removes the keyboard listeners.
 */
function subscribe(onChange: () => void): () => void {
    if (watchers.size === 0) {
        listen();
    }

    watchers.add(onChange);

    return () => {
        watchers.delete(onChange);

        if (watchers.size === 0) {
            removers.forEach((remove) => {
                remove();
            });
            removers = [];
            reported = null;
        }
    };
}

/** Whether an on-screen keyboard is open now. A boolean, so a read twice gives the same value. */
function snapshot(): boolean {
    return reported ?? platformReading();
}

/**
 * Whether an on-screen keyboard is open.
 *
 * @returns `true` while a keyboard at least 150 dp tall is showing or about to show.
 * @sideEffect Listens for keyboard show and hide events while mounted.
 */
export function useKeyboardShown(): boolean {
    return useSyncExternalStore(subscribe, snapshot, snapshot);
}
