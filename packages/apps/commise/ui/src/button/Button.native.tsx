/**
 * @module @commise/ui/button — the native design-system {@link Button} (React Native).
 *
 * Mirrors the web leaf's contract and visual language with a RN `StyleSheet`: an icon + label pill with a
 * real surface for every tier (filled primary, bordered secondary, bordered error-toned destructive). The
 * `Pressable` is a single accessibility element — `accessibilityRole="button"` + a label-derived
 * `accessibilityLabel` — and the caller's icon is wrapped so it is hidden from assistive tech, so the label
 * alone is the accessible name (keeping RN/Maestro name selection stable).
 */
import type { FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { palette, semantic } from '../tokens/colors.js';
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
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={resolveAccessibilityLabel(accessibilityLabel, children)}
            accessibilityState={{ disabled: inactive, busy }}
            disabled={inactive}
            onPress={onPress}
            style={({ pressed }) => [
                styles.base,
                variantStyle[variant],
                pressed && !inactive ? styles.pressed : null,
                inactive ? styles.inactive : null,
            ]}
        >
            <View style={styles.icon} aria-hidden>
                {icon}
            </View>
            <Text style={[styles.label, labelStyle[variant]]}>{children}</Text>
        </Pressable>
    );
};

const styles = StyleSheet.create({
    base: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        borderRadius: 999,
        paddingVertical: 12,
        paddingHorizontal: 20,
    },
    icon: { flexShrink: 0 },
    label: { fontWeight: '600', fontSize: 14 },
    pressed: { opacity: 0.9 },
    inactive: { opacity: 0.6 },
});

/** Per-tier surface — the native idiom of the shared {@link ButtonVariant} set (see the web leaf's map). */
const variantStyle: Record<ButtonVariant, object> = {
    primary: { backgroundColor: palette.seafoam },
    secondary: { backgroundColor: palette.white, borderWidth: 1, borderColor: semantic.border },
    destructive: { backgroundColor: palette.white, borderWidth: 1, borderColor: palette.error },
};

/** Per-tier label colour, paired with {@link variantStyle}. */
const labelStyle: Record<ButtonVariant, object> = {
    primary: { color: palette.white },
    secondary: { color: palette.charcoal },
    destructive: { color: palette.error },
};
