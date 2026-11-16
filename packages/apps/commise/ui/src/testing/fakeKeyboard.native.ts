/**
 * @module @commise/ui/testing/fake-keyboard: the one way a native test stands in for React Native's `Keyboard`.
 *
 * It records every listener the code under test adds, answers `isVisible` and `metrics` from a state the test moves, and
 * fires an event with a complete, typed payload, so no test builds its own half-shaped event or casts a listener.
 *
 * ⚠️ jsdom has no keyboard: react-native-web's `Keyboard` has no `metrics`, so the double defines it, as the device API does.
 *
 * @pattern Test Double (Fake) — a scripted `Keyboard` whose events and state a test moves together
 */
import { Keyboard, type KeyboardEvent } from 'react-native';
import { vi } from 'vitest';

/** The events the design system listens for. */
export type KeyboardEventName = 'keyboardWillShow' | 'keyboardWillHide' | 'keyboardDidShow' | 'keyboardDidHide';

/** Where the fake keyboard is on the screen. */
export interface FakeKeyboardFrame {
    readonly screenY: number;
    readonly height: number;
}

/** What a test drives, and reads back, on the installed double. */
export interface FakeKeyboard {
    /** Every event name the code under test has added a listener for, in order. */
    readonly added: readonly KeyboardEventName[];
    /** How many listeners have been removed. */
    readonly removed: () => number;
    /** Move React Native's own state (`isVisible`, `metrics`) as it moves on a Did event; `null` closes the keyboard. */
    settle: (frame: FakeKeyboardFrame | null) => void;
    /** Fire an event to its listener, with `frame` as its `endCoordinates` (a closed keyboard when omitted). */
    emit: (name: KeyboardEventName, frame?: FakeKeyboardFrame) => void;
    /** Put `Keyboard` back as it was. */
    restore: () => void;
}

const SCREEN_WIDTH = 390;

/**
 * Replace `Keyboard.addListener`, `isVisible` and `metrics` with a fake.
 *
 * @returns The handle that drives it. Call `restore` (or `vi.restoreAllMocks`, then `restore`) in `afterEach`.
 * @sideEffect Spies on `Keyboard` and defines `Keyboard.metrics`.
 */
export function installFakeKeyboard(): FakeKeyboard {
    const listeners = new Map<KeyboardEventName, (event: KeyboardEvent) => void>();
    const added: KeyboardEventName[] = [];
    let removals = 0;
    let state: FakeKeyboardFrame | null = null;

    // The ONE cast: `addListener` returns an `EmitterSubscription`, a class this double does not build; `remove` is all the
    // code under test calls on it.
    vi.spyOn(Keyboard, 'addListener').mockImplementation(((
        name: KeyboardEventName,
        listener: (event: KeyboardEvent) => void,
    ) => {
        added.push(name);
        listeners.set(name, listener);

        return {
            remove: () => {
                removals += 1;
                listeners.delete(name);
            },
        };
    }) as unknown as typeof Keyboard.addListener);
    vi.spyOn(Keyboard, 'isVisible').mockImplementation(() => state !== null);
    Object.defineProperty(Keyboard, 'metrics', {
        value: () => (state === null ? undefined : { ...state, width: SCREEN_WIDTH, screenX: 0 }),
        configurable: true,
    });

    return {
        added,
        removed: () => removals,
        settle: (frame) => {
            state = frame;
        },
        emit: (name, frame = { screenY: 0, height: 0 }) => {
            listeners.get(name)?.({
                duration: 0,
                easing: 'keyboard',
                endCoordinates: { ...frame, width: SCREEN_WIDTH, screenX: 0 },
            });
        },
        restore: () => {
            Reflect.deleteProperty(Keyboard, 'metrics');
        },
    };
}
