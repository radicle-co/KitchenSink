/**
 * @module @commise/ui/button — the native design-system {@link Button} (React Native).
 *
 * Mirrors the web leaf's contract and states with a RN `StyleSheet` (`docs/design/uiOverhaul/buildSpec.md` §1.10): the
 * Registry glyph for its meaning beside its label, on the surface its tier and size select. The accessible button is
 * the {@link PressScale} `Pressable` this leaf composes — one accessibility element (`accessibilityRole="button"` + a
 * label-derived name) that also gives the pill its motion-safe press-scale, which is the native pressed state (§1.9).
 * The glyph sits in a hidden slot and is drawn in the label's colour, so the label alone is the name.
 *
 * - **Sizes** (§1.6): 52, 44 and 36 visual points, each rounded to HALF its height (E2 I2: a wrapped label stays
 *   inside the curve). On Android every 44 is 48 dp: `md` grows to 48, and `sm`'s hit area does. `sm` is hit at 44
 *   (48) by a transparent frame around the 36 pt pill, so the target is measurable rather than a `hitSlop`.
 * - **Type**: the label is the `label` role — one registered Inter face per weight and never a `fontWeight` (§1.5),
 *   which on Android resolves to a synthesised or system bold instead of the face.
 * - **Busy** swaps the glyph slot for an `ActivityIndicator` in place and disables the control; **disabled** dims to
 *   40%.
 *
 * Every tier is ONE flat surface (the owner removed the primary gradient): the `action` fill, neutral secondary,
 * surface-less ghost, and destructive's danger label (filled `danger` only in its `confirm` tone). Each colour comes
 * from `useTheme()` at render, so the button repaints in the dark scheme; the static sheet holds layout only (D15).
 *
 * @pattern Discriminated union (`ButtonProps`) rendered with a `StyleSheet`, composing `PressScale` — which owns the
 *     `Pressable`, so the accessible button is ONE element rather than a nested pair.
 * @pattern Adapter over the screen-reader focus API — a level-triggered focus request moves the cursor to the
 *     `Pressable` through `PressScale`'s handle (`AccessibilityInfo.sendAccessibilityEvent` has no declarative form).
 */
import { useRef, type FC, type ReactNode } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { useFocusRequest } from '../focusRequest/useFocusRequest.js';
import { Icon } from '../icon/Icon.native.js';
import type { Role } from '../tokens/colors.js';
import { nativeTokens } from '../tokens/native.js';
import { useTheme } from '../theme/useTheme.native.js';
import type { Theme } from '../theme/themeFor.js';
import { PressScale } from '../pressScale/index.js';
import { moveScreenReaderFocus } from '../screenReaderFocus/moveScreenReaderFocus.native.js';
import { surfaceOf, type ButtonProps, type ButtonSize } from './props.js';

/** The visual height of each size, in points (§1.6). */
const VISUAL_HEIGHT: Readonly<Record<ButtonSize, number>> = { lg: 52, md: 44, sm: 36 };

/** The touch floor: 44 pt on iOS, 48 dp on Android (§1.6, "every 44 in this file is 48 dp on Android"). */
const touchFloor = (): number => (Platform.OS === 'android' ? 48 : 44);

/** A size's visual height on this platform: `md` IS the touch floor, so it grows with it on Android. Pure. */
const visualHeightOf = (size: ButtonSize): number => (size === 'md' ? touchFloor() : VISUAL_HEIGHT[size]);

/** The flat surfaces and the role each one's label and glyph share. */
type Surface = 'primary' | 'secondary' | 'ghost' | 'destructiveInline' | 'destructiveConfirm';

/** Each surface's foreground role — the label AND the glyph AND the spinner, so the three always agree. */
const FOREGROUND: Readonly<Record<Surface, Role>> = {
    primary: 'onAction',
    secondary: 'ink',
    ghost: 'actionText',
    destructiveInline: 'dangerText',
    destructiveConfirm: 'onAction',
};

/**
 * Each surface's paint in the current theme — the native idiom of the web leaf's map (the two change for different
 * reasons, so they are deliberately not merged). Built at render from `useTheme()`: a colour in the static sheet would
 * be baked into one theme at import (D15). Pure.
 */
function surfacePaint({ colors }: Theme, surface: Surface): ViewStyle {
    switch (surface) {
        case 'primary':
            return { backgroundColor: colors.action, borderWidth: 0 };
        case 'secondary':
        case 'destructiveInline':
            return { backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.lineControl };
        case 'ghost':
            return { backgroundColor: 'transparent', borderWidth: 0 };
        case 'destructiveConfirm':
            return { backgroundColor: colors.danger, borderWidth: 0 };
    }
}

/** Resolve the accessible name: an explicit override, else the string label, else undefined. */
const resolveAccessibilityLabel = (
    accessibilityLabel: string | undefined,
    children: ButtonProps['children'],
): string | undefined => accessibilityLabel ?? (typeof children === 'string' ? children : undefined);

/** The native design-system button — the meaning's glyph + label, one surface per tier and size. */
export const Button: FC<ButtonProps> = (props) => {
    const {
        icon,
        children,
        size = 'md',
        onPress,
        disabled = false,
        busy = false,
        accessibilityLabel,
        width = 'auto',
        focusRequested = false,
        onFocusRequestHandled,
    } = props;
    const { variant, tone } = surfaceOf(props);
    const surface: Surface =
        variant === 'destructive' ? (tone === 'confirm' ? 'destructiveConfirm' : 'destructiveInline') : variant;
    const foreground = FOREGROUND[surface];
    const theme = useTheme();
    const node = useRef<View>(null);
    useFocusRequest(focusRequested, () => moveScreenReaderFocus(node.current), onFocusRequestHandled);

    // A busy control is also disabled so an in-flight action cannot be double-fired.
    const inactive = disabled || busy;
    const height = visualHeightOf(size);
    const geometry: ViewStyle = { minHeight: height, borderRadius: height / 2 };

    const content: ReactNode = (
        <>
            {busy || icon !== undefined ? (
                <View style={styles.glyph} aria-hidden>
                    {busy || icon === undefined ? (
                        <ActivityIndicator color={theme.colors[foreground]} />
                    ) : (
                        <Icon name={icon} size={20} tone={foreground} />
                    )}
                </View>
            ) : null}
            <Text style={[styles.label, { color: theme.colors[foreground] }]}>{children}</Text>
        </>
    );

    // ONE flat surface per tier (the owner removed the primary gradient, `modernizeB.md` §3).
    const pill = (
        <View style={[styles.base, geometry, surfacePaint(theme, surface), inactive ? styles.inactive : null]}>
            {content}
        </View>
    );

    return (
        <PressScale
            ref={node}
            onPress={onPress}
            disabled={inactive}
            busy={busy}
            accessibilityRole="button"
            accessibilityLabel={resolveAccessibilityLabel(accessibilityLabel, children)}
            width={width}
        >
            {/* `sm` draws below the touch floor, so a transparent frame carries the hit area around it. */}
            {height < touchFloor() ? <View style={[styles.hitFrame, { minHeight: touchFloor() }]}>{pill}</View> : pill}
        </PressScale>
    );
};

const styles = StyleSheet.create({
    base: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: nativeTokens.spacing[2],
        paddingVertical: nativeTokens.spacing[2],
        paddingHorizontal: nativeTokens.spacing[5],
    },
    hitFrame: { justifyContent: 'center' },
    glyph: { flexShrink: 0 },
    label: nativeTokens.type.label,
    inactive: { opacity: 0.4 },
});
