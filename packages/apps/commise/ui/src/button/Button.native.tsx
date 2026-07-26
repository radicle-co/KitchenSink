/**
 * @module @commise/ui/button — the native design-system {@link Button} (React Native).
 *
 * Mirrors the web leaf's contract and visual language with a RN `StyleSheet`: an icon + label pill with a
 * real surface for every tier (filled primary, bordered secondary, bordered error-toned destructive). The
 * accessible button is the {@link PressScale} `Pressable` this leaf composes — one accessibility element
 * (`accessibilityRole="button"` + a label-derived name) that also gives the pill its motion-safe
 * press-scale. The caller's icon is wrapped so it is hidden from assistive tech, so the label alone is the
 * accessible name (keeping RN/Maestro name selection stable).
 *
 * Two touch/loading behaviours mirror the web leaf in the native idiom:
 *  - **Touch target** — the pill carries `minHeight: 44` (comfortable touch) with vertical padding from
 *    `nativeTokens`, so short labels still hit a 44pt target.
 *  - **Busy** — the `busy` prop swaps the icon slot for a real `ActivityIndicator` in place (no layout
 *    shift) and disables the control (so an in-flight action cannot be double-fired).
 */
import type { FC } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { nativeTokens } from '../tokens/native.js';
import { palette, semantic } from '../tokens/colors.js';
import { PressScale } from '../pressScale/index.js';
import type { ButtonProps, ButtonVariant } from './props.js';

/** Resolve the accessible name: an explicit override, else the string label, else undefined. */
const resolveAccessibilityLabel = (
    accessibilityLabel: string | undefined,
    children: ButtonProps['children'],
): string | undefined => accessibilityLabel ?? (typeof children === 'string' ? children : undefined);

/** The native design-system button — icon + label, one visible surface per tier. */
export const Button: FC<ButtonProps> = ({
    variant = 'primary',
    icon,
    children,
    onPress,
    disabled = false,
    busy = false,
    accessibilityLabel,
}) => {
    // A busy control is also disabled so an in-flight action cannot be double-fired.
    const inactive = disabled || busy;

    return (
        <PressScale
            onPress={onPress}
            disabled={inactive}
            busy={busy}
            accessibilityRole="button"
            accessibilityLabel={resolveAccessibilityLabel(accessibilityLabel, children)}
        >
            <View style={[styles.base, variantStyle[variant], inactive ? styles.inactive : null]}>
                <View style={styles.icon} aria-hidden>
                    {busy ? <ActivityIndicator color={labelColor[variant]} /> : icon}
                </View>
                <Text style={[styles.label, { color: labelColor[variant] }]}>{children}</Text>
            </View>
        </PressScale>
    );
};

const styles = StyleSheet.create({
    base: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        // Comfortable 44pt touch target with tokenized vertical padding.
        minHeight: 44,
        gap: nativeTokens.spacing[2],
        borderRadius: nativeTokens.radius.full,
        paddingVertical: nativeTokens.spacing[3],
        paddingHorizontal: nativeTokens.spacing[5],
    },
    icon: { flexShrink: 0 },
    label: { fontWeight: '600', fontSize: nativeTokens.fontSize.bodySm },
    inactive: { opacity: 0.6 },
});

/** Per-tier surface — the native idiom of the shared {@link ButtonVariant} set (see the web leaf's map). */
const variantStyle: Record<ButtonVariant, object> = {
    primary: { backgroundColor: palette.seafoam },
    secondary: { backgroundColor: palette.white, borderWidth: 1, borderColor: semantic.border },
    destructive: { backgroundColor: palette.white, borderWidth: 1, borderColor: palette.error },
};

/** Per-tier foreground colour — paints the label AND the busy spinner so the two always agree. */
const labelColor: Record<ButtonVariant, string> = {
    primary: palette.white,
    secondary: palette.charcoal,
    destructive: palette.error,
};
