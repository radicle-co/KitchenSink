/**
 * @module @commise/ui/input — the native design-system {@link Input}: a one-line text field on the shared field
 * geometry (`fieldStyle.ts`), named by the `FieldLabel` above it.
 *
 * The field's `aria-labelledby` names its label's `nativeID` (`fieldLabelId(id)`), which only Android honours, so
 * `label` repeats it as the `accessibilityLabel` iOS reads. React Native 0.86 has no `aria-invalid` and no
 * `aria-describedby` (they compile and do nothing on a device), so neither is passed: `invalid` is the `danger` edge
 * alone, and a message reaches a screen reader as `error`, the field's `accessibilityHint` (which also implies the edge). The
 * keyboard, autofill and return-key hints pass straight to React Native's `TextInput`, which maps them per OS (on iOS,
 * `autoComplete` also sets the `textContentType` autofill reads). The return key's BEHAVIOUR is derived from its hint
 * (`specSharedSystem.md` §16.1): `next` submits and keeps the keyboard up, so the host's `onSubmit` can move focus to the
 * following field; every other key blurs, as a single-line field does by default. It renders through `@commise/ui/text-input`, which
 * keeps Android's full-screen editor away from every field.
 *
 * While it has focus it asks the field reveal host to hold it in view (`useFocusReveal`), and when the screen names it
 * (`ScrollHost.scrollToField`) the host centres it and the screen-reader cursor moves to it, with the keyboard left down
 * (`useFieldTargetReveal`, `docs/design/uiOverhaul/specSharedSystem.md` §16.3).
 *
 * @pattern Template — one field geometry (`fieldStyle.ts`), rendered by both native text-field leaves
 * @pattern Adapter over `TextInput.focus()` — a level-triggered focus request, acknowledged once taken. It is the one
 *     reason this leaf holds a ref: focusing a field has no declarative form. The same node is what the reveal host
 *     measures and what the screen-reader cursor moves to.
 */
import { useRef, useState, type FC } from 'react';
import { StyleSheet, type TextInput as NativeTextInput } from 'react-native';

import { useFieldTargetReveal } from '../fieldReveal/useFieldTargetReveal.native.js';
import { useFocusReveal } from '../fieldReveal/useFocusReveal.native.js';
import { useTheme } from '../theme/useTheme.native.js';
import { TextInput } from '../textInput/TextInput.native.js';
import { fieldDisabled, fieldGeometry, fieldPaint } from './fieldStyle.js';
import { fieldAccessibilityHint, fieldLabelId, type InputProps } from './props.js';
import { useFocusRequest } from '../focusRequest/useFocusRequest.js';

/** The native design-system one-line text field. */
export const Input: FC<InputProps> = ({
    id,
    value,
    onChangeText,
    invalid = false,
    error,
    hint,
    label,
    placeholder,
    autoCapitalize,
    autoCorrect,
    disabled = false,
    inputMode,
    autoComplete,
    enterKeyHint,
    secret = false,
    onSubmit,
    maxLength,
    focusRequested = false,
    onFocusRequestHandled,
}) => {
    const theme = useTheme();
    const node = useRef<NativeTextInput>(null);
    useFocusRequest(focusRequested, () => node.current?.focus(), onFocusRequestHandled);
    // Whether the field has focus: the reveal host holds it in view while it does (§16.3).
    const [focused, setFocused] = useState(false);
    useFocusReveal(node, focused);
    useFieldTargetReveal(id, node);

    return (
        <TextInput
            ref={node}
            nativeID={id}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            value={value}
            onChangeText={onChangeText}
            aria-labelledby={fieldLabelId(id)}
            accessibilityLabel={label}
            accessibilityHint={fieldAccessibilityHint(error, hint)}
            placeholder={placeholder}
            placeholderTextColor={theme.colors.inkMuted}
            autoCapitalize={autoCapitalize}
            autoCorrect={autoCorrect}
            editable={!disabled}
            inputMode={inputMode}
            autoComplete={autoComplete}
            enterKeyHint={enterKeyHint}
            submitBehavior={enterKeyHint === 'next' ? 'submit' : 'blurAndSubmit'}
            secureTextEntry={secret}
            onSubmitEditing={onSubmit}
            maxLength={maxLength}
            style={[styles.field, fieldPaint(theme, invalid || error !== undefined), disabled ? styles.disabled : null]}
        />
    );
};

const styles = StyleSheet.create({ field: fieldGeometry, disabled: fieldDisabled });
