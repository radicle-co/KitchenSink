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
 * - **Inline padding** is web's base step, 12 points on every tier and size, so three actions fit a 320 pt row.
 * - **Type**: the label is the `cardTitle` role (16/20/600, owner ruling B1) — one registered Inter face per weight and never a `fontWeight` (§1.5),
 *   which on Android resolves to a synthesised or system bold instead of the face.
 * - **Busy** swaps the glyph slot for an `ActivityIndicator` in place and disables the control; **disabled** dims to
 *   40%.
 *
 * Every tier is ONE flat surface (the owner removed the primary gradient): the `action` fill, neutral secondary,
 * surface-less ghost and quiet (an `actionText` label; an `ink` label with an `actionText` glyph), and destructive's danger label (filled
 * `danger` only in its `confirm` tone). Each colour comes
 * from `useTheme()` at render, so the button repaints in the dark scheme; the static sheet holds layout only (D15).
 *
 * @pattern Discriminated union (`ButtonProps`) rendered with a `StyleSheet`, composing `PressScale` — which owns the
 *     `Pressable`, so the accessible button is ONE element rather than a nested pair.
 * @pattern Adapter over the screen-reader focus API — a level-triggered focus request moves the cursor to the
 *     `Pressable` through `PressScale`'s handle (`AccessibilityInfo.sendAccessibilityEvent` has no declarative form).
 */
import { useRef, type FC, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { useFocusRequest } from '../focusRequest/useFocusRequest.js';
import { Icon } from '../icon/Icon.native.js';
import { touchFloor } from '../layout/touchFloor.native.js';
import type { Role } from '../tokens/colors.js';
import { nativeTokens } from '../tokens/native.js';
import { useTheme } from '../theme/useTheme.native.js';
import { PressScale } from '../pressScale/index.js';
import { moveScreenReaderFocus } from '../screenReaderFocus/moveScreenReaderFocus.native.js';
import { dimmedOpacity } from '../tokens/scale.js';
import { BUTTON_VISUAL_HEIGHT, surfaceOf, type ButtonProps, type ButtonSize } from './props.js';
import { BUTTON_PILL_LAYOUT, buttonSurfacePaint, type ButtonSurface } from './surfacePaint.native.js';

/** A size's visual height on this platform: `md` IS the touch floor, so it grows with it on Android. Pure. */
const visualHeightOf = (size: ButtonSize): number => (size === 'md' ? touchFloor() : BUTTON_VISUAL_HEIGHT[size]);

/** Each surface's foreground role — the label AND the glyph AND the spinner, so the three always agree. */
const FOREGROUND: Readonly<Record<ButtonSurface, Role>> = {
    primary: 'onAction',
    secondary: 'ink',
    ghost: 'actionText',
    quiet: 'ink',
    destructiveInline: 'dangerText',
    destructiveConfirm: 'onAction',
};

/**
 * Each surface's GLYPH and spinner role. Every tier draws them in its label's colour except `quiet`: an `ink` label with
 * an `actionText` glyph (`componentFixes.md` §1), the web leaf's `buttonGlyphClass`.
 */
const GLYPH: Readonly<Record<ButtonSurface, Role>> = { ...FOREGROUND, quiet: 'actionText' };

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
        refused = false,
        accessibilityLabel,
        description,
        expanded,
        width = 'auto',
        iconPlacement = 'start',
        focusRequested = false,
        onFocusRequestHandled,
    } = props;
    const { variant, tone } = surfaceOf(props);
    const surface: ButtonSurface =
        variant === 'destructive' ? (tone === 'confirm' ? 'destructiveConfirm' : 'destructiveInline') : variant;
    const foreground = FOREGROUND[surface];
    const glyphRole = GLYPH[surface];
    const theme = useTheme();
    const node = useRef<View>(null);
    useFocusRequest(focusRequested, () => moveScreenReaderFocus(node.current), onFocusRequestHandled);

    // A busy or refused control is also disabled so an in-flight action cannot be double-fired; a disabled `Pressable`
    // keeps screen-reader focus on device, so native needs no web-style focus guard.
    const inactive = disabled || busy || refused;
    const height = visualHeightOf(size);
    const geometry: ViewStyle = { minHeight: height, borderRadius: height / 2 };

    const glyph: ReactNode =
        busy || icon !== undefined ? (
            <View style={styles.glyph} aria-hidden>
                {busy || icon === undefined ? (
                    <ActivityIndicator color={theme.colors[glyphRole]} />
                ) : (
                    <Icon name={icon} size={20} tone={glyphRole} />
                )}
            </View>
        ) : null;
    const content: ReactNode = (
        <>
            {iconPlacement === 'start' ? glyph : null}
            <Text style={[styles.label, { color: theme.colors[foreground] }]}>{children}</Text>
            {iconPlacement === 'end' ? glyph : null}
        </>
    );

    // ONE flat surface per tier (the owner removed the primary gradient, `modernizeB.md` §3).
    // Kept, so busy or disabled (`opacity`) never moves the glyph and label into it (`nativeFlattenFlips.test.ts`).
    const pill = (
        <View
            collapsable={false}
            style={[styles.base, geometry, buttonSurfacePaint(theme, surface), inactive ? styles.inactive : null]}
        >
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
            accessibilityHint={description}
            expanded={expanded}
            width={width}
        >
            {/* `sm` draws below the touch floor, so a transparent frame carries the hit area around it. */}
            {height < touchFloor() ? <View style={[styles.hitFrame, { minHeight: touchFloor() }]}>{pill}</View> : pill}
        </PressScale>
    );
};

const styles = StyleSheet.create({
    base: BUTTON_PILL_LAYOUT,
    hitFrame: { justifyContent: 'center' },
    glyph: { flexShrink: 0 },
    label: nativeTokens.type.cardTitle,
    inactive: { opacity: dimmedOpacity },
});
