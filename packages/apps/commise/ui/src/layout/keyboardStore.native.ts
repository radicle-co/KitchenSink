/**
 * @module @commise/ui/layout — the one reading of keyboard state: the ONE subscription to React Native's `Keyboard`, and
 * the frame it reports. The shown flag ({@link useKeyboardShown}) and the sheet's and snackbar host's frame
 * (`useKeyboardFrame`) are both readers of {@link subscribeToKeyboard} and {@link keyboardFrameSnapshot} here, so they can
 * never disagree about which event they have seen (`docs/design/compactHeightLayout.md` §2).
 *
 * It follows the same moment as the keyboard avoider's padding. On iOS that is `keyboardWillShow` and
 * `keyboardWillHide`, and the state comes from the event's own `endCoordinates`, because `Keyboard.isVisible()` and
 * `Keyboard.metrics()` change only on `keyboardDidShow` and would still read the old keyboard. iOS also listens for the
 * Did events, so a reader that mounted between Will and Did, and so read the old keyboard, is corrected when the
 * keyboard settles and not at the next keyboard event. Android sends only the Did events.
 *
 * @pattern Adapter over React Native's `Keyboard` — the shared store is an Observer that `useSyncExternalStore` readers
 *     subscribe to
 */
import { Keyboard, Platform, type KeyboardEvent } from 'react-native';

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
