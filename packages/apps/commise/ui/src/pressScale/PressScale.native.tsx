/**
 * @module @commise/ui/press-scale — the native design-system {@link PressScale} press-feedback primitive.
 *
 * Owns the interaction: it renders the `Pressable` and drives a `transform: [{ scale }]` from that
 * `Pressable`'s `pressed` state, so a held control shrinks to `PRESS_SCALE` and springs back on
 * release. The scale is suppressed when the control is disabled and — crucially — when the OS "reduce
 * motion" setting is on (non-essential motion is gated), mirroring the web leaf's `motion-safe:` gate. The
 * branch itself lives in the pure {@link pressedScale} so it is provable without a renderer, and the
 * preference is read through the design system's single {@link useReduceMotion} reader.
 */
import type { FC } from 'react';
import { Pressable, type StyleProp, type ViewStyle } from 'react-native';

import { useReduceMotion } from '../motion/useReduceMotion.native.js';
import { pressedScale } from './pressedScale.js';
import type { PressScaleProps } from './props.js';

/** The Commise press-feedback wrapper — a `Pressable` that scales its content while held (motion-safe). */
export const PressScale: FC<PressScaleProps> = ({
    children,
    onPress,
    disabled = false,
    busy = false,
    accessibilityLabel,
    accessibilityRole = 'button',
}) => {
    // A press gate has nothing to show before the first press, so the not-yet-known preference collapses to
    // "motion allowed" here — unlike an enter transition, which must hold its from-state until it knows.
    const reduceMotion = useReduceMotion() ?? false;

    return (
        <Pressable
            onPress={onPress}
            disabled={disabled}
            accessibilityRole={accessibilityRole}
            accessibilityLabel={accessibilityLabel}
            accessibilityState={{ disabled, busy }}
            // `aria-busy` is React Native's own first-class ALIAS for `accessibilityState.busy` (declared in
            // `ViewAccessibility.d.ts`), NOT a web-only attribute — so it is device-correct on
            // VoiceOver/TalkBack. Both forms are emitted deliberately: react-native-web reads
            // `accessibilityState` for `disabled` ONLY (`AccessibilityUtil/isDisabled` is its sole consumer)
            // and otherwise forwards just the literal `aria-*` props, so `accessibilityState.busy` alone
            // reaches the device but emits NOTHING in the DOM — leaving the in-flight state of every native
            // DS control unobservable, and therefore untestable. Carrying the alias too makes `busy` both
            // announced and assertable. Do not "simplify" by dropping either one.
            aria-busy={busy || undefined}
            style={({ pressed }): StyleProp<ViewStyle> => ({
                transform: [{ scale: pressedScale({ pressed, disabled, reduceMotion }) }],
            })}
        >
            {children}
        </Pressable>
    );
};
