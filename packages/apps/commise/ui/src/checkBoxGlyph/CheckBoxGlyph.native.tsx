/**
 * @module @commise/ui/check-box-glyph — the native design-system {@link CheckBoxGlyph}.
 *
 * A 24 pt box: a 2 pt `lineControl` outline when unchecked, the `action` fill with an `onAction` check when checked.
 * Checking springs the check in from scale 0.9 with the signature overshoot (§1.9: stiffness 600, damping 28); under
 * reduced motion, or while the preference is still being read, it appears at once. Hidden from assistive technology —
 * the row it sits in is the checkbox. Colours come from the theme at render, so it repaints in the dark scheme.
 *
 * @pattern Adapter over React Native's imperative `Animated` spring — the signature check motion, owned here so the
 *     rows that draw it stay pure
 */
import { useEffect, useState, type FC } from 'react';
import { Animated, Platform, StyleSheet, View } from 'react-native';

import { Icon } from '../icon/Icon.native.js';
import { useReduceMotion } from '../motion/useReduceMotion.native.js';
import { useTheme } from '../theme/useTheme.native.js';
import type { CheckBoxGlyphProps } from './props.js';

/** The spring of the one signature motion (`buildSpec.md` §1.9). */
const CHECK_SPRING = { stiffness: 600, damping: 28, mass: 1 } as const;

/** The scale the check springs in from. */
const CHECK_FROM_SCALE = 0.9;

/** The native whole-row checkbox's box. */
export const CheckBoxGlyph: FC<CheckBoxGlyphProps> = ({ checked }) => {
    const { colors } = useTheme();
    const reduceMotion = useReduceMotion();
    // Created once and never replaced, so state is its home (see `EnterTransition.native.tsx`).
    const [scale] = useState(() => new Animated.Value(1));

    useEffect(() => {
        if (!checked || reduceMotion !== false) {
            scale.setValue(1);

            return undefined;
        }

        scale.setValue(CHECK_FROM_SCALE);
        const animation = Animated.spring(scale, {
            toValue: 1,
            ...CHECK_SPRING,
            useNativeDriver: Platform.OS !== 'web',
        });
        animation.start();

        return () => animation.stop();
    }, [checked, reduceMotion, scale]);

    return (
        <View
            aria-hidden
            importantForAccessibility="no-hide-descendants"
            style={[
                styles.box,
                checked
                    ? { backgroundColor: colors.action, borderColor: colors.action }
                    : { backgroundColor: 'transparent', borderColor: colors.lineControl },
            ]}
        >
            {checked ? (
                <Animated.View style={{ transform: [{ scale }] }}>
                    <Icon name="check" size={16} tone="onAction" />
                </Animated.View>
            ) : null}
        </View>
    );
};

const styles = StyleSheet.create({
    box: {
        width: 24,
        height: 24,
        borderRadius: 4,
        borderWidth: 2,
        alignItems: 'center',
        justifyContent: 'center',
    },
});
