/**
 * @module @commise/ui/surface — the native {@link GradientSurface} brand primitive (React Native).
 *
 * Mirrors the web leaf using `expo-linear-gradient`: the single-source `gradient` spec is projected
 * (`toNativeGradient`) to the `colors`/`locations`/`start`/`end` the library consumes, so the native and
 * web (`linear-gradient`) legs paint the identical brand gradient. Presentational and static (a gradient
 * background carries no motion), so there is nothing to gate on reduced motion.
 *
 * @pattern Adapter projecting the same single-source `gradient` spec onto `expo-linear-gradient`'s
 *     `colors`/`locations`/`start`/`end`, so both legs paint the identical brand gradient from one definition.
 */
import { LinearGradient } from 'expo-linear-gradient';
import type { FC } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

import { gradient as gradientTokens, toNativeGradient } from '../tokens/gradients.js';
import type { GradientSurfaceProps } from './props.js';

/** The Commise gradient background surface — the brand gradient painted behind arbitrary hero content. */
export const GradientSurface: FC<GradientSurfaceProps> = ({
    gradient = 'hero',
    children,
    style,
    accessibilityLabel,
}) => {
    const spec = toNativeGradient(gradientTokens[gradient]);

    return (
        <LinearGradient
            colors={spec.colors}
            locations={spec.locations}
            start={spec.start}
            end={spec.end}
            style={style as StyleProp<ViewStyle>}
            accessible={accessibilityLabel !== undefined || undefined}
            accessibilityLabel={accessibilityLabel}
        >
            {children}
        </LinearGradient>
    );
};
