/**
 * @module @commise/ui/input — the native design-system {@link Input}: a one-line text field on the shared field
 * geometry (`fieldStyle.ts`), named by the `FieldLabel` above it.
 *
 * The field's `aria-labelledby` names its label's `nativeID` (`fieldLabelId(id)`), so the visible label IS its
 * accessible name. `invalid` sets `aria-invalid` and the `danger` edge; `describedBy` names the caller's message. The
 * keyboard, autofill and return-key hints pass straight to React Native's `TextInput`, which maps them per OS (on iOS,
 * `autoComplete` also sets the `textContentType` autofill reads). It renders through `@commise/ui/text-input`, which
 * keeps Android's full-screen editor away from every field.
 *
 * @pattern Template — one field geometry (`fieldStyle.ts`), rendered by both native text-field leaves
 * @pattern Adapter over `TextInput.focus()` — a level-triggered focus request, acknowledged once taken. It is the one
 *     reason this leaf holds a ref: focusing a field has no declarative form.
 */
import { useRef, type FC } from 'react';
import { StyleSheet, type TextInput as NativeTextInput } from 'react-native';

import { useTheme } from '../theme/useTheme.native.js';
import { TextInput } from '../textInput/TextInput.native.js';
import { fieldDisabled, fieldGeometry, fieldPaint } from './fieldStyle.js';
import { fieldLabelId, type InputProps } from './props.js';
import { useFocusRequest } from '../focusRequest/useFocusRequest.js';

/** The native design-system one-line text field. */
export const Input: FC<InputProps> = ({
    id,
    value,
    onChangeText,
    invalid = false,
    describedBy,
    placeholder,
    autoCapitalize,
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

    return (
        <TextInput
            ref={node}
            nativeID={id}
            value={value}
            onChangeText={onChangeText}
            aria-labelledby={fieldLabelId(id)}
            aria-invalid={invalid}
            aria-describedby={describedBy}
            placeholder={placeholder}
            placeholderTextColor={theme.colors.inkMuted}
            autoCapitalize={autoCapitalize}
            editable={!disabled}
            inputMode={inputMode}
            autoComplete={autoComplete}
            enterKeyHint={enterKeyHint}
            secureTextEntry={secret}
            onSubmitEditing={onSubmit}
            maxLength={maxLength}
            style={[styles.field, fieldPaint(theme, invalid), disabled ? styles.disabled : null]}
        />
    );
};

const styles = StyleSheet.create({ field: fieldGeometry, disabled: fieldDisabled });
