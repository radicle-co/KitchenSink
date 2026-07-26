/**
 * @module @commise/ui/press-scale — the native design-system {@link PressScale} press-feedback primitive.
 *
 * Owns the interaction: it renders the `Pressable` and drives a `transform: [{ scale }]` from that
 * `Pressable`'s `pressed` state, so a held control shrinks to {@link PRESS_SCALE} and springs back on
 * release. The scale is suppressed when the control is disabled and — crucially — when the OS "reduce
 * motion" setting is on (non-essential motion is gated), mirroring the web leaf's `motion-safe:` gate. The
 * branch itself lives in the pure {@link pressedScale} so it is provable without a renderer.
 */
import { useEffect, useState, type FC } from 'react';
import { AccessibilityInfo, Pressable, type StyleProp, type ViewStyle } from 'react-native';

import { pressedScale } from './pressedScale.js';
import type { PressScaleProps } from './props.js';

/**
 * Track the OS reduce-motion preference. This is external-system synchronisation (an accessibility
 * setting that can change at runtime), which is exactly what `useEffect` is for.
 *
 * @sideEffect Subscribes to `AccessibilityInfo` reduce-motion changes for the component's lifetime.
 */
function useReduceMotion(): boolean {
    const [reduceMotion, setReduceMotion] = useState(false);

    useEffect(() => {
        let subscribed = true;
        void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
            if (subscribed) {
                setReduceMotion(enabled);
            }
        });
        // `addEventListener` returns an `EmitterSubscription` on device; some hosts (e.g. the
        // react-native-web test shim) return nothing, so unsubscribe defensively.
        const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion) as
            | { remove: () => void }
            | undefined;

        return () => {
            subscribed = false;
            subscription?.remove();
        };
    }, []);

    return reduceMotion;
}

/** The Commise press-feedback wrapper — a `Pressable` that scales its content while held (motion-safe). */
export const PressScale: FC<PressScaleProps> = ({
    children,
    onPress,
    disabled = false,
    busy = false,
    accessibilityLabel,
    accessibilityRole = 'button',
}) => {
    const reduceMotion = useReduceMotion();

    return (
        <Pressable
            onPress={onPress}
            disabled={disabled}
            accessibilityRole={accessibilityRole}
            accessibilityLabel={accessibilityLabel}
            accessibilityState={{ disabled, busy }}
            style={({ pressed }): StyleProp<ViewStyle> => ({
                transform: [{ scale: pressedScale({ pressed, disabled, reduceMotion }) }],
            })}
        >
            {children}
        </Pressable>
    );
};
