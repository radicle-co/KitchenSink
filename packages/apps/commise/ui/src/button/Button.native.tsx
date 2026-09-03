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
 *
 * The `primary` tier paints the SAME `gradient.brand` (seafoam → ocean-dark) the web leaf carries as the
 * Tailwind `from-seafoam to-ocean-dark` utility — projected through `toNativeGradient` into
 * `expo-linear-gradient` — so the two platforms' primary CTA converge on one single-sourced gradient
 * (round-2 R7). Secondary/destructive stay flat surfaces: `secondary` is the mockups' CORAL-outlined glass
 * degraded to `glass.subtle`'s own solid fallback (RN has no `backdrop-filter`), `destructive` an
 * error-toned outline.
 *
 * @pattern The same `ButtonProps` contract rendered with a `StyleSheet`, composing `PressScale` — which owns the
 *     `Pressable`, so the accessible button is ONE element rather than a nested pair.
 */
import { LinearGradient } from 'expo-linear-gradient';
import type { FC, ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { glass, gradient, toNativeGradient } from '../tokens/gradients.js';
import { nativeTokens } from '../tokens/native.js';
import { palette } from '../tokens/colors.js';
import { PressScale } from '../pressScale/index.js';
import type { ButtonProps, ButtonVariant } from './props.js';

/** The native projection of the brand CTA gradient (seafoam → ocean-dark) — computed once, module-level. */
const brandGradient = toNativeGradient(gradient.brand);

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

    const content: ReactNode = (
        <>
            <View style={styles.icon} aria-hidden>
                {busy ? <ActivityIndicator color={labelColor[variant]} /> : icon}
            </View>
            <Text style={[styles.label, { color: labelColor[variant] }]}>{children}</Text>
        </>
    );

    // The primary tier's surface IS the brand gradient; the flat tiers paint a solid/bordered View.
    const pill =
        variant === 'primary' ? (
            <LinearGradient
                colors={brandGradient.colors}
                locations={brandGradient.locations}
                start={brandGradient.start}
                end={brandGradient.end}
                style={[styles.base, inactive ? styles.inactive : null]}
            >
                {content}
            </LinearGradient>
        ) : (
            <View style={[styles.base, flatSurface[variant], inactive ? styles.inactive : null]}>{content}</View>
        );

    return (
        <PressScale
            onPress={onPress}
            disabled={inactive}
            busy={busy}
            accessibilityRole="button"
            accessibilityLabel={resolveAccessibilityLabel(accessibilityLabel, children)}
        >
            {pill}
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

/**
 * Per-tier FLAT surface — the native idiom of the shared {@link ButtonVariant} set (see the web leaf's
 * map). `primary` is intentionally absent: its surface is the brand `LinearGradient`, not a flat colour.
 *
 * `secondary` mirrors the web leaf's mockup-derived CORAL-outlined glass. React Native has no
 * `backdrop-filter`, so the native projection of that glass is the tier's own solid `fallback` — literally
 * the value `toWebGlass(glass.subtle, false)` paints on a blurless web host, so the two platforms degrade to
 * the same colour from the same token rather than one of them re-spelling "white".
 */
const flatSurface: Record<Exclude<ButtonVariant, 'primary'>, object> = {
    secondary: { backgroundColor: glass.subtle.fallback, borderWidth: 2, borderColor: palette.coral },
    destructive: { backgroundColor: palette.white, borderWidth: 1, borderColor: palette.error },
};

/**
 * Per-tier foreground colour — paints the label AND the busy spinner so the two always agree.
 *
 * `secondary` is SLATE, not the coral the mockups put on this tier's label: coral-as-text is 2.40:1 against
 * the glass, below WCAG AA's 4.5:1, while slate is 5.24:1. The web leaf makes the identical substitution
 * (`text-slate`), so a screen-reader-invisible colour choice cannot diverge across platforms.
 *
 * `destructive` is `error-dark`, the FOREGROUND half of the destructive red — `error` is the fill this tier
 * deliberately does NOT paint (the flat pill is white with an error hairline), and as text it is only 4.33:1
 * on `sand`. The web leaf's `text-error-dark` is the same substitution.
 */
const labelColor: Record<ButtonVariant, string> = {
    primary: palette.white,
    secondary: palette.slate,
    destructive: palette['error-dark'],
};
