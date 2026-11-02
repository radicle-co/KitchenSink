/**
 * @module @commise/ui/search-field — give a native text input KEYBOARD focus when a counter the screen owns CHANGES.
 *
 * The sibling of `useScreenReaderFocusOnSignal`, which moves the reading cursor and never the keyboard. A control that
 * stands elsewhere in the reading order (the Recipes search proxy) hands the cook to the real field with this: the
 * input takes focus, the keyboard opens, and the screen reader follows the focus.
 *
 * ## Why a ref
 *
 * `TextInput.focus()` is imperative and has no declarative form (`autoFocus` fires once at mount only). `seen` is
 * compared and advanced inside the effect, so a discarded render cannot consume the change and a remount does not
 * steal focus.
 *
 * @pattern Adapter over `TextInput.focus()`, driven by a caller-owned signal
 */
import { useEffect, useRef, type RefObject } from 'react';
import type { TextInput } from 'react-native';

/**
 * Focus an input when `signal` changes.
 *
 * @param input - The ref attached to the input.
 * @param signal - A counter the caller advances for each press that should focus the input. Inert on mount.
 * @sideEffect Calls `focus()` on the input when `signal` changes.
 */
export function useFocusInputOnSignal(input: RefObject<TextInput | null>, signal: number | undefined): void {
    const seen = useRef(signal);

    useEffect(() => {
        if (seen.current === signal) {
            return;
        }

        seen.current = signal;
        input.current?.focus();
    }, [input, signal]);
}
