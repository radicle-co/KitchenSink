/**
 * @module @commise/ui/surface — the native {@link GlassCard} brand primitive (React Native).
 *
 * Mirrors the web leaf using `expo-blur`'s `BlurView`: the single-source `glass` spec is projected
 * (`toNativeGlass`) to a blur `intensity` + `tint`, with the translucent surface tint layered over the
 * blur. When `blurSupported` is `false` the card renders the opaque solid `fallback` in a plain `View`
 * (older Android / low-power paths where blur is unsupported or janky) so the content stays readable.
 */
import { BlurView } from 'expo-blur';
import type { FC } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { glass as glassTokens, toNativeGlass } from '../tokens/gradients.js';
import type { GlassCardProps } from './props.js';

/** The Commise frosted-glass card — translucent-over-blur when supported, opaque solid fallback when not. */
export const GlassCard: FC<GlassCardProps> = ({
    tier = 'card',
    blurSupported = true,
    children,
    style,
    accessibilityLabel,
}) => {
    const spec = toNativeGlass(glassTokens[tier]);
    const a11y = accessibilityLabel !== undefined ? { accessible: true, accessibilityLabel } : {};

    if (!blurSupported) {
        return (
            <View style={[{ backgroundColor: spec.fallback }, style] as StyleProp<ViewStyle>} {...a11y}>
                {children}
            </View>
        );
    }

    return (
        <BlurView
            intensity={spec.intensity}
            tint={spec.tint}
            style={[{ backgroundColor: spec.surface }, style] as StyleProp<ViewStyle>}
            {...a11y}
        >
            {children}
        </BlurView>
    );
};
