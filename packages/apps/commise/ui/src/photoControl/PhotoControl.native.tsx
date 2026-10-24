/**
 * @module @commise/ui/photo-control — the native design-system {@link PhotoControl} (see `props.ts`): regular,
 * untinted, interactive Liquid Glass on iOS 26, and a solid `photoChip` disc everywhere else, in the system's theme.
 *
 * Presentational: props → JSX. Which device it is on is read, not decided.
 *
 * @pattern Adapter over `expo-glass-effect`, with a solid fallback where the platform has no glass
 */
import { GlassView } from 'expo-glass-effect';
import type { FC } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { hasLiquidGlass } from '../chromeSurface/liquidGlass.native.js';
import { Icon } from '../icon/Icon.native.js';
import { useTheme } from '../theme/useTheme.native.js';
import type { PhotoControlProps } from './props.js';

/** The disc's diameter: the 44 pt minimum touch target, and the spec's size. */
const DISC_PX = 44;

/** The native control over a photo. */
export const PhotoControl: FC<PhotoControlProps> = ({ icon, label, onPress }) => {
    const { colors } = useTheme();
    const glyph = <Icon name={icon} size={24} tone="ink" />;

    if (hasLiquidGlass()) {
        return (
            <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.disc}>
                <GlassView glassEffectStyle="regular" isInteractive colorScheme="auto" style={styles.fill}>
                    {glyph}
                </GlassView>
            </Pressable>
        );
    }

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={label}
            onPress={onPress}
            style={[styles.disc, styles.center, { backgroundColor: colors.photoChip }]}
        >
            {glyph}
        </Pressable>
    );
};

const styles = StyleSheet.create({
    disc: { width: DISC_PX, height: DISC_PX, borderRadius: DISC_PX / 2, overflow: 'hidden' },
    center: { alignItems: 'center', justifyContent: 'center' },
    fill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
