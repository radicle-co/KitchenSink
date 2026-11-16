/**
 * @module @commise/ui/layout — the ONE reading of the native on-screen keyboard. The sheet and the screen frames read
 * whether it is shown ({@link useKeyboardShown}); the sheet's lift and the snackbar host read where it is
 * (`useKeyboardFrame`, which is a reader of {@link subscribeToKeyboard} and {@link keyboardFrameSnapshot} here)
 * (`docs/design/compactHeightLayout.md` §2).
 *
 * Shown only while the keyboard is at least as tall as `ON_SCREEN_KEYBOARD_MIN_HEIGHT`, so an iPad shortcut bar or a
 * hardware keyboard's accessory bar never collapses the sheet or a screen frame.
 *
 * It follows the same moment as the keyboard avoider's padding. On iOS that is `keyboardWillShow` and
 * `keyboardWillHide`, and the state comes from the event's own `endCoordinates`, because `Keyboard.isVisible()` and
 * `Keyboard.metrics()` change only on `keyboardDidShow` and would still read the old keyboard. iOS also listens for the
 * Did events, so a reader that mounted between Will and Did, and so read the old keyboard, is corrected when the
 * keyboard settles and not at the next keyboard event. Android sends only the Did events.
 *
 * @pattern Adapter over React Native's `Keyboard` — `useSyncExternalStore` is the subscription (Observer); the rule
 *     is `isOnScreenKeyboard`.
 */
import { useSyncExternalStore } from 'react';
import { Keyboard, Platform, type KeyboardEvent } from 'react-native';

import { isOnScreenKeyboard } from '../sheet/onScreenKeyboard.js';

/** Where the keyboard is on the screen. */
export interface KeyboardFrame {
    readonly top: number;
    readonly height: number;
}

/** What the last event said (`null`: no keyboard), or `undefined` when there is none to trust (no reader mounted). */
let reported: KeyboardFrame | null | undefined;
/** The last frame read from React Native's own state, kept so a read twice returns the same object. */
let platformFrame: KeyboardFrame | null = null;
const watchers = new Set<() => void>();
let removers: readonly (() => void)[] = [];

/** React Native's own state: right after a Did event, and the start before any event. */
function platformReading(): KeyboardFrame | null {
    const metrics = Keyboard.isVisible() ? Keyboard.metrics() : undefined;

    if (metrics === undefined) {
        platformFrame = null;
    } else if (platformFrame?.top !== metrics.screenY || platformFrame.height !== metrics.height) {
        platformFrame = { top: metrics.screenY, height: metrics.height };
    }

    return platformFrame;
}

/** Tell every mounted reader to read again. */
function notify(): void {
    watchers.forEach((watcher) => {
        watcher();
    });
}

/**
 * Start listening: the Will events on iOS, whose event carries the keyboard's end frame, and the Did events on every
 * platform.
 *
 * @sideEffect Adds the keyboard listeners.
 */
function listen(): void {
    const subscriptions = (Platform.OS === 'ios' ? (['Will', 'Did'] as const) : (['Did'] as const)).flatMap((when) => [
        Keyboard.addListener(`keyboard${when}Show`, (event: KeyboardEvent) => {
            reported = { top: event.endCoordinates.screenY, height: event.endCoordinates.height };
            notify();
        }),
        Keyboard.addListener(`keyboard${when}Hide`, () => {
            reported = null;
            notify();
        }),
    ]);

    removers = subscriptions.map((subscription) => () => {
        subscription.remove();
    });
}

/**
 * One set of listeners serves every mounted reader. The last one to leave removes them and forgets the report, so a
 * reader that mounts later reads React Native's state and not an event it missed.
 *
 * @sideEffect Adds and removes the keyboard listeners.
 */
export function subscribeToKeyboard(onChange: () => void): () => void {
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
            reported = undefined;
        }
    };
}

/** Where the keyboard is now, or `null` with none up. The same object until the keyboard moves, so a read twice agrees. */
export function keyboardFrameSnapshot(): KeyboardFrame | null {
    return reported === undefined ? platformReading() : reported;
}

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
