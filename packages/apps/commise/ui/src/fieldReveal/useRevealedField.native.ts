/**
 * @module @commise/ui/field-reveal — wire one text input to the field reveal host in a single call.
 *
 * A field the keyboard can cover asks the host to hold it in view while it has focus (`useFocusReveal`). That takes the
 * field's node, its focus state, and the two handlers that track it, which every such field needs the same way, so they
 * are written once: spread the result onto the `TextInput`.
 *
 * ## Why a ref and state
 *
 * The host measures the field's native node, which has no declarative form, so the hook keeps the node the input hands
 * back. The focus state is what the request follows: sent on focus, released on blur or unmount.
 *
 * @pattern Adapter over `useFocusReveal` — the node, focus state and handlers a field needs to be revealed
 */
import { useRef, useState, type RefObject } from 'react';
import type { TextInput } from 'react-native';

import { useFocusReveal } from './useFocusReveal.native.js';

/** What to spread onto the input. */
export interface RevealedFieldProps {
    readonly ref: RefObject<TextInput | null>;
    readonly onFocus: () => void;
    readonly onBlur: () => void;
}

/**
 * The props that make one input reveal itself while it has focus.
 *
 * @returns The `ref`, `onFocus` and `onBlur` to spread onto a `TextInput`.
 * @sideEffect Sends a `focus` request to the reveal host's revealer while the input has focus.
 */
export function useRevealedField(): RevealedFieldProps {
    const ref = useRef<TextInput>(null);
    const [focused, setFocused] = useState(false);

    useFocusReveal(ref, focused);

    return { ref, onFocus: () => setFocused(true), onBlur: () => setFocused(false) };
}
