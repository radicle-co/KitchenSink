/**
 * @module @commise/ui/text-input — the one React Native `TextInput` the apps render
 * (`docs/design/compactHeightLayout.md` §7).
 *
 * On a phone held sideways, Android may hand a focused field a full-screen editor of its own unless
 * `disableFullscreenUI` is set (React Native: "the OS may choose to have the user edit the text inside of a full
 * screen text input mode"; Android only). That editor hides the whole app, and with it everything a field means beside:
 * its label (SC 3.3.2), a search's results, the phrase the erase dialog asks the cook to copy, which ingredient row a
 * quantity belongs to. The app keeps a focused field above the keyboard instead, so this adapter fixes the prop for
 * EVERY field, multiline too, and takes it out of the API. iOS has no such editor; the prop does nothing there.
 *
 * Every other prop passes through, `ref` included (React 19 hands a function component its ref as a prop), so a caller
 * that focuses its field keeps doing so. A value import of `TextInput` from `react-native` anywhere else in the apps
 * fails `packages/infra/global/__tests__/textInputAdapterImports.test.ts`; a type-only one, for typing a ref, is fine.
 *
 * A field with a `nativeID` also registers itself while mounted (`labelFocus.native.ts`), so the `FieldLabel` naming
 * that id focuses it when pressed, as a web `<label for>` does. That takes the field's node, through a callback ref
 * composed with the caller's: `.focus()` has no declarative form.
 *
 * @pattern Adapter over React Native's `TextInput` — one prop fixed, the `@commise/ui/modal` precedent
 * @pattern Registry client — a field with an id registers itself for its label (`labelFocus.native.ts`)
 */
import { useComposedRefs } from '@radix-ui/react-compose-refs';
import { useCallback, type ComponentPropsWithRef, type FC } from 'react';
import { TextInput as NativeTextInput } from 'react-native';

import { registerLabelledField } from './labelFocus.native.js';

/** React Native's `TextInput` props, `ref` included, less the full-screen editor this adapter owns. */
export type TextInputProps = Omit<ComponentPropsWithRef<typeof NativeTextInput>, 'disableFullscreenUI'>;

/**
 * React Native's `TextInput`, never in Android's full-screen editor, and focusable by its label. A presentational
 * component: it renders its props and holds no state. Native only, because only Android has the editor.
 */
export const TextInput: FC<TextInputProps> = ({ ref, ...props }) => {
    const { nativeID } = props;
    const labelTarget = useCallback(
        (node: NativeTextInput | null) =>
            node === null || nativeID === undefined ? undefined : registerLabelledField(nativeID, node),
        [nativeID],
    );
    const composed = useComposedRefs(ref, labelTarget);

    return <NativeTextInput {...props} ref={composed} disableFullscreenUI />;
};

/**
 * Whether a text field holds focus now — React Native's own focus record, read here because this adapter is the one
 * module that may touch React Native's `TextInput` (`textInputAdapterImports.test.ts`). The record clears when the field
 * blurs or unmounts.
 *
 * @returns Whether any field is focused.
 */
export function hasFocusedField(): boolean {
    return NativeTextInput.State.currentlyFocusedInput() !== null;
}
