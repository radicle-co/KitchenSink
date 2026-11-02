/**
 * @module @commise/ui/horizontal-scroller — the scroll hint's chevron, the one part Tamagui cannot draw yet: its opacity is
 * an `Animated.Value` (the config has no animation driver), which takes one React Native style, held here and nowhere
 * else. This file must not import `tamagui` (a file that does holds no React Native styling).
 *
 * Orchestration: it owns the opacity animation and reads the reduce-motion preference; it fetches nothing.
 *
 * @pattern Adapter — an Animated.Value opacity behind a plain component
 */
import { useEffect, useState, type FC } from 'react';
import { Animated, Easing, Platform } from 'react-native';

import { Icon } from '../icon/Icon.native.js';
import { useReduceMotion } from '../motion/useReduceMotion.native.js';

/** How long the chevron takes to appear or go. */
const CHEVRON_MS = 150;

/** Props for {@link ScrollChevron}. */
export interface ScrollChevronProps {
    /** Whether anything has been measured yet; before that the chevron stays at its initial 0. */
    readonly measured: boolean;
    /** Whether the chevron shows. */
    readonly show: boolean;
}

/**
 * The decorative chevron. It fades over 150 ms, and not at all while the OS reduce-motion preference is on or not yet
 * known.
 */
export const ScrollChevron: FC<ScrollChevronProps> = ({ measured, show }) => {
    const reduceMotion = useReduceMotion();
    // Created once and never replaced, like `EnterTransition`'s progress: state is its home, not a ref.
    const [opacity] = useState(() => new Animated.Value(0));

    useEffect(() => {
        if (!measured) {
            return undefined;
        }

        const toValue = show ? 1 : 0;

        if (reduceMotion !== false) {
            opacity.setValue(toValue);

            return undefined;
        }

        const animation = Animated.timing(opacity, {
            toValue,
            duration: CHEVRON_MS,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: Platform.OS !== 'web',
        });

        animation.start();

        return () => animation.stop();
    }, [measured, show, reduceMotion, opacity]);

    return (
        // NATIVE-STYLE-ADAPTER: an Animated.Value drives the opacity, and Tamagui has no animation driver configured.
        <Animated.View style={{ opacity }}>
            <Icon name="chevronRight" size={20} tone="inkMuted" />
        </Animated.View>
    );
};
