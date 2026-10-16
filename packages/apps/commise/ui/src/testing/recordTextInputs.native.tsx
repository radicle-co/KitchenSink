/**
 * @module @commise/ui/testing/record-text-inputs — a test double for `@commise/ui/text-input` that renders the REAL
 * field and records the props it was handed, keyed by `nativeID` (else by `accessibilityLabel`).
 *
 * react-native-web drops `accessibilityHint` and reads `accessibilityLabel` into `aria-label`, so a DOM query cannot see
 * what VoiceOver and TalkBack are told, and a host suite that asserts `aria-invalid` or `aria-describedby` passes while
 * a device (which has neither) does nothing. A suite that wraps the adapter with this double keeps its flows running and
 * asserts the props that reach a device. Use it from a `vi.mock` FACTORY through a dynamic import, because `vi.mock` is
 * hoisted above static imports:
 *
 * ```ts
 * vi.mock('@commise/ui/text-input', async (importOriginal) => {
 *     const { recordingTextInputModule } = await import('@commise/ui/testing/record-text-inputs');
 *
 *     return recordingTextInputModule(await importOriginal<typeof import('@commise/ui/text-input')>());
 * });
 * ```
 *
 * Clear {@link recordedTextInputs} in `afterEach`.
 *
 * @pattern Test Double (Spy) — wraps the real adapter and records what it was handed
 */
import { createElement, type FC } from 'react';

import type { TextInputProps } from '../textInput/TextInput.native.js';

/** The props each field last rendered with, keyed by its `nativeID`, else its `accessibilityLabel`. */
export const recordedTextInputs = new Map<string, TextInputProps>();

/**
 * A copy of the adapter's module whose `TextInput` records its props and then renders the real one.
 *
 * @param actual - The real module (`importOriginal()`).
 * @returns The same module with a recording `TextInput`.
 * @sideEffect Each render of the returned `TextInput` writes {@link recordedTextInputs}.
 */
export function recordingTextInputModule<M extends { readonly TextInput: FC<TextInputProps> }>(actual: M): M {
    const Real = actual.TextInput;

    const TextInput: FC<TextInputProps> = (props) => {
        const key = props.nativeID ?? props.accessibilityLabel;

        if (key !== undefined) {
            recordedTextInputs.set(key, props);
        }

        return createElement(Real, props);
    };

    return { ...actual, TextInput };
}

/**
 * The props the field with this id last rendered with.
 *
 * @param id - The field's `nativeID`, or its `accessibilityLabel` when it has none.
 * @returns Its props.
 * @throws When no such field rendered, so a wrong id cannot read as "the field has no hint".
 */
export function recordedTextInput(id: string): TextInputProps {
    const found = recordedTextInputs.get(id);

    if (found === undefined) {
        throw new Error(`No text input with the id "${id}" was rendered.`);
    }

    return found;
}

/**
 * The props of the field whose `accessibilityLabel` is this, for a field whose `nativeID` is generated (`useId`).
 *
 * @param label - The field's accessibility label.
 * @returns Its props.
 * @throws When no rendered field carries it.
 */
export function recordedTextInputLabelled(label: string): TextInputProps {
    const found = [...recordedTextInputs.values()].find((props) => props.accessibilityLabel === label);

    if (found === undefined) {
        throw new Error(`No text input labelled "${label}" was rendered.`);
    }

    return found;
}
