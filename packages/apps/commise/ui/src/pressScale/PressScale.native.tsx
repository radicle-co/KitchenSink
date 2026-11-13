/**
 * @module @commise/ui/press-scale — the native design-system {@link PressScale} press-feedback primitive.
 *
 * Owns the interaction: it renders the `Pressable` and drives a `transform: [{ scale }]` from that
 * `Pressable`'s `pressed` state, so a held control shrinks to `PRESS_SCALE` and springs back on
 * release. The scale is suppressed when the control is disabled and — crucially — when the OS "reduce
 * motion" setting is on (non-essential motion is gated), mirroring the web leaf's `motion-safe:` gate. The
 * branch itself lives in the pure {@link pressedScale} so it is provable without a renderer, and the
 * preference is read through the design system's single {@link useReduceMotion} reader.
 *
 * The pressed state is tracked here, from the `Pressable`'s press-in and press-out, so the scale and a function child
 * read the same flag. The scale and the width live on `PressScaleFrame`, a Tamagui view around the `Pressable`, so the
 * leaf sets no React Native style (ADR-0080). The frame has no events and no accessibility props, so the `Pressable`
 * stays the one press responder and the one control a screen reader finds. `asChild` was weighed and rejected: the test
 * lane cannot see a style an `asChild` frame lends its child (`tamaguiRuntimeProbe.native.test.tsx`).
 *
 * @pattern Adapter over the RN `Pressable` — React Native has no ancestor `:active`, so this leaf OWNS the pressable
 *     and drives the scale from its pressed state, which is why the web leaf decorates and this one adapts.
 * @pattern Decorator — `PressScaleFrame` adds the width and the press scale around the `Pressable`
 */
import { useState, type FC } from 'react';
import { Pressable } from 'react-native';
import { styled, View } from 'tamagui';

import { useReduceMotion } from '../motion/useReduceMotion.native.js';
import { pressedScale } from './pressedScale.js';
import type { PressScaleProps, PressScaleWidth } from './props.js';

/**
 * The frame around the `Pressable`. `span` is the {@link PressScaleWidth}: `auto` adds nothing, so the parent decides (a
 * column stretches its children), and `fill` stretches the frame across a parent that would otherwise centre it. The
 * frame keeps the default column stretch, so the `Pressable` fills it either way. Not `width`, which is Tamagui's
 * style prop.
 */
const PressScaleFrame = styled(View, {
    name: 'PressScaleFrame',

    variants: {
        span: {
            auto: {},
            fill: { alignSelf: 'stretch' },
        } satisfies Record<PressScaleWidth, object>,
    } as const,
});

/** The Commise press-feedback wrapper — a `Pressable` that scales its content while held (motion-safe). */
export const PressScale: FC<PressScaleProps> = ({
    children,
    onPress,
    disabled = false,
    busy = false,
    accessibilityLabel,
    accessibilityHint,
    accessibilityRole = 'button',
    ref,
    expanded,
    checked,
    width = 'auto',
}) => {
    // A press gate has nothing to show before the first press, so the not-yet-known preference collapses to
    // "motion allowed" here — unlike an enter transition, which must hold its from-state until it knows.
    const reduceMotion = useReduceMotion() ?? false;
    const [pressed, setPressed] = useState(false);

    return (
        <PressScaleFrame span={width} scale={pressedScale({ pressed, disabled, reduceMotion })}>
            <Pressable
                ref={ref}
                onPress={onPress}
                onPressIn={() => {
                    setPressed(true);
                }}
                onPressOut={() => {
                    setPressed(false);
                }}
                disabled={disabled}
                accessibilityRole={accessibilityRole}
                accessibilityLabel={accessibilityLabel}
                accessibilityHint={accessibilityHint}
                // `expanded` only when stated: `false` is COLLAPSED, and absent means "not a disclosure".
                accessibilityState={{
                    disabled,
                    busy,
                    ...(expanded === undefined ? {} : { expanded }),
                    ...(checked === undefined ? {} : { checked }),
                }}
                // `aria-busy` is React Native's own first-class ALIAS for `accessibilityState.busy` (declared in
                // `ViewAccessibility.d.ts`), NOT a web-only attribute — so it is device-correct on
                // VoiceOver/TalkBack. Both forms are emitted deliberately: react-native-web reads
                // `accessibilityState` for `disabled` ONLY (`AccessibilityUtil/isDisabled` is its sole consumer)
                // and otherwise forwards just the literal `aria-*` props, so `accessibilityState.busy` alone
                // reaches the device but emits NOTHING in the DOM — leaving the in-flight state of every native
                // DS control unobservable, and therefore untestable. Carrying the alias too makes `busy` both
                // announced and assertable. Do not "simplify" by dropping either one.
                aria-busy={busy || undefined}
                // The same dual-channel reasoning as `aria-busy` above, for disclosure state.
                aria-expanded={expanded}
                // And for a switch's or a checkbox's state: `accessibilityState.checked` reaches the device, `aria-checked`
                // the DOM.
                aria-checked={checked}
            >
                {typeof children === 'function' ? children({ pressed }) : children}
            </Pressable>
        </PressScaleFrame>
    );
};
