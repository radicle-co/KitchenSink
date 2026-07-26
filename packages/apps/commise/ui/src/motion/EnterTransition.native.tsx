/**
 * @module @commise/ui/motion — the native design-system {@link EnterTransition} primitive (React Native).
 *
 * Mirrors the web leaf's gesture — a short rise + fade — with an `Animated.Value` instead of a CSS keyframe,
 * because React Native has no CSS. It OWNS the animation, so consuming leaves stay pure `props → JSX`.
 *
 * The reduce-motion gate is the delicate part. RN can only read the preference asynchronously, so the
 * three-way decision lives in the pure {@link enterMotionMode}:
 *  - `pending` — hold the from-state and start nothing. This costs a frame or two of invisibility, and that
 *    is the deliberate trade: the alternative (assume motion is allowed, then correct) plays the first slice
 *    of the animation at a reduce-motion user before snapping, which is precisely what the setting forbids.
 *  - `instant` — `setValue(1)`: settled, with no animation object ever created.
 *  - `animate` — run the timing, and CANCEL it on unmount / on a preference change (an animation left
 *    running against an unmounted view is a leak).
 */
import { useEffect, useRef, type FC } from 'react';
import { Animated, Easing, Platform } from 'react-native';

import { ENTER_DURATION_MS, ENTER_RISE_PX, enterMotionMode } from './enterMotion.js';
import { useReduceMotion } from './useReduceMotion.native.js';
import type { EnterTransitionProps } from './props.js';

/** The Commise enter-transition wrapper — a section that rises + fades in when motion is safe. */
export const EnterTransition: FC<EnterTransitionProps> = ({ children, delayMs = 0 }) => {
    const reduceMotion = useReduceMotion();
    const mode = enterMotionMode({ reduceMotion });
    // A ref wrapping `Animated` — the one sanctioned use: an imperative, non-declarative external system
    // whose value must survive re-renders and has no declarative equivalent in React Native.
    const progress = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        if (mode === 'pending') {
            return;
        }

        if (mode === 'instant') {
            // Reduce motion is ON: land on the settled state without creating an animation at all.
            progress.setValue(1);

            return;
        }

        const animation = Animated.timing(progress, {
            toValue: 1,
            duration: ENTER_DURATION_MS,
            delay: delayMs,
            easing: Easing.out(Easing.cubic),
            // Opacity + translateY are both native-driver-safe on device. Under react-native-web (tests) the
            // native animated module does not exist, so asking for it there only produces a warning.
            useNativeDriver: Platform.OS !== 'web',
        });

        animation.start();

        return () => animation.stop();
    }, [mode, delayMs, progress]);

    return (
        <Animated.View
            style={{
                opacity: progress,
                transform: [
                    {
                        translateY: progress.interpolate({
                            inputRange: [0, 1],
                            outputRange: [ENTER_RISE_PX, 0],
                        }),
                    },
                ],
            }}
        >
            {children}
        </Animated.View>
    );
};
