/**
 * @module @commise/ui/input — the native design-system {@link Input} (React Native).
 *
 * A tokenized, controlled, label-associated text field. Every metric comes from `nativeTokens` and every
 * colour from the shared palette, so it cannot drift from the design system the way the hand-rolled
 * `.native` inputs did. Accessibility is wired at the primitive level, not left to each caller:
 *  - the label `Text` carries a `nativeID` and the field references it via `aria-labelledby`, so the label
 *    text IS the field's accessible name;
 *  - when `error` is present, the field is marked `aria-invalid` and points at an `alert`-role error slot
 *    via `aria-describedby`, so assistive tech announces the message with the field.
 *
 * Presentational only — it owns no state; the composing form supplies `value` and handles `onChangeText`.
 *
 * @pattern Facade over the RN text-field primitives — it wires the label association, the `alert`-role error slot and
 *     every metric from `nativeTokens` at the primitive level, so no caller can drift by wiring them itself.
 */
import { useId, type FC } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { nativeTokens } from '../tokens/native.js';
import { palette, semantic } from '../tokens/colors.js';
import type { InputProps } from './props.js';

/** The native design-system text field — label + input + optional error slot, tokenized and a11y-wired. */
export const Input: FC<InputProps> = ({
    label,
    value,
    onChangeText,
    error,
    placeholder,
    secureTextEntry,
    keyboardType,
    autoCapitalize,
    autoComplete,
    textContentType,
    returnKeyType,
    onSubmitEditing,
    editable = true,
    accessibilityLabel,
}) => {
    const id = useId();
    const labelId = `${id}-label`;
    const errorId = `${id}-error`;
    const hasError = error !== undefined && error !== '';

    return (
        <View style={styles.field}>
            <Text nativeID={labelId} style={styles.label}>
                {label}
            </Text>
            <TextInput
                value={value}
                onChangeText={onChangeText}
                placeholder={placeholder}
                // Placeholder text is TEXT, so it takes `slate`, never the `mist` hairline tone — see the
                // palette JSDoc in `../tokens/colors.ts`. Fixing it in the primitive fixes every form built on
                // it; there is no web `Input.tsx` (this primitive is native-only), so there is no second half.
                placeholderTextColor={palette.slate}
                secureTextEntry={secureTextEntry}
                keyboardType={keyboardType}
                autoCapitalize={autoCapitalize}
                autoComplete={autoComplete}
                textContentType={textContentType}
                returnKeyType={returnKeyType}
                onSubmitEditing={onSubmitEditing}
                editable={editable}
                accessibilityLabel={accessibilityLabel}
                aria-labelledby={accessibilityLabel === undefined ? labelId : undefined}
                aria-invalid={hasError}
                aria-describedby={hasError ? errorId : undefined}
                style={[styles.input, hasError ? styles.inputError : null, editable ? null : styles.inputDisabled]}
            />
            {hasError ? (
                <Text nativeID={errorId} role="alert" style={styles.errorText}>
                    {error}
                </Text>
            ) : null}
        </View>
    );
};

const styles = StyleSheet.create({
    field: { gap: nativeTokens.spacing[1] },
    label: {
        fontSize: nativeTokens.fontSize.bodySm,
        fontWeight: '600',
        color: palette.charcoal,
    },
    input: {
        minHeight: 44,
        borderWidth: 1,
        borderColor: semantic.border,
        borderRadius: nativeTokens.radius.md,
        paddingHorizontal: nativeTokens.spacing[3],
        paddingVertical: nativeTokens.spacing[2],
        fontSize: nativeTokens.fontSize.bodyMd,
        color: palette.charcoal,
        backgroundColor: palette.white,
    },
    inputError: { borderColor: palette.error },
    inputDisabled: { backgroundColor: palette.pearl, color: palette.slate },
    errorText: {
        fontSize: nativeTokens.fontSize.caption,
        color: palette['error-dark'],
    },
});
