/**
 * @module @commise/ui/input — prop contract for the design-system native `Input`.
 *
 * A tokenized, label-associated text field for the React Native surfaces (the auth/identity screens rebuild
 * on it). It is intentionally **native-only**: the web surfaces already own a field idiom, so there is no
 * web leaf — `@commise/ui/input` resolves to `Input.native.tsx` everywhere. The control is presentational +
 * controlled: it owns NO state, just renders `value`, reports edits via `onChangeText`, and wires a label
 * and an optional error slot to the field for assistive tech.
 */
import type { KeyboardTypeOptions, ReturnKeyTypeOptions, TextInputProps } from 'react-native';

/** The contract for the native design-system text field. */
export interface InputProps {
    /** The visible field label, associated with the input for assistive tech (`aria-labelledby`). */
    readonly label: string;
    /** The controlled text value. */
    readonly value: string;
    /** Reports each edit to the field's text. */
    readonly onChangeText: (text: string) => void;
    /**
     * An optional validation message. When present, an alert-role error slot renders below the field and is
     * wired to it (`aria-describedby`), and the field is marked `aria-invalid`.
     */
    readonly error?: string;
    /** Placeholder shown when the field is empty. */
    readonly placeholder?: string;
    /** Masks input for passwords. */
    readonly secureTextEntry?: boolean;
    /** The on-screen keyboard layout (e.g. `email-address`, `numeric`). */
    readonly keyboardType?: KeyboardTypeOptions;
    /** Auto-capitalisation behaviour. Defaults to the platform default. */
    readonly autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
    /** Autofill hint (e.g. `email`, `password`, `one-time-code`). */
    readonly autoComplete?: TextInputProps['autoComplete'];
    /** iOS content-type hint for autofill (e.g. `oneTimeCode`, `emailAddress`). */
    readonly textContentType?: TextInputProps['textContentType'];
    /** The return-key label/behaviour (e.g. `next`, `done`). */
    readonly returnKeyType?: ReturnKeyTypeOptions;
    /** Invoked when the return key is pressed. */
    readonly onSubmitEditing?: TextInputProps['onSubmitEditing'];
    /** Whether the field is editable. Defaults to `true`; `false` dims and locks it. */
    readonly editable?: boolean;
    /**
     * Overrides the label-derived accessible name. Prefer letting {@link label} own the name; use this only
     * when the field needs a name distinct from its visible label.
     */
    readonly accessibilityLabel?: string;
}
