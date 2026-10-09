/**
 * @module @commise/ui/chrome-surface — the native design-system {@link ChromeSurface}: real Liquid Glass on iOS 26, a
 * solid `paperRaised` surface everywhere else (see `props.ts`). It fills its parent and takes no touches.
 *
 * Presentational: props → JSX. Which device it is on is read, not decided.
 *
 * @pattern Adapter over `expo-glass-effect`, with a solid fallback where the platform has no glass
 */
import { GlassView } from 'expo-glass-effect';
import type { FC } from 'react';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '../theme/useTheme.native.js';
import { hasLiquidGlass } from './liquidGlass.native.js';
import type { ChromeSurfaceProps } from './props.js';

/** The native design-system bar material. */
export const ChromeSurface: FC<ChromeSurfaceProps> = ({ edge, visible = true }) => {
    const { colors } = useTheme();

    if (hasLiquidGlass()) {
        return (
            <GlassView
                pointerEvents="none"
                style={StyleSheet.absoluteFill}
                glassEffectStyle={{ style: visible ? 'regular' : 'none', animate: true }}
                colorScheme="auto"
            />
        );
    }

    const hairline = edge === 'top' ? styles.hairlineTop : styles.hairlineBottom;

    return (
        <View
            pointerEvents="none"
            style={[
                StyleSheet.absoluteFill,
                visible ? hairline : null,
                visible ? { backgroundColor: colors.paperRaised, borderColor: colors.lineDivider } : null,
            ]}
        />
    );
};

const styles = StyleSheet.create({
    hairlineTop: { borderTopWidth: StyleSheet.hairlineWidth },
    hairlineBottom: { borderBottomWidth: StyleSheet.hairlineWidth },
});
