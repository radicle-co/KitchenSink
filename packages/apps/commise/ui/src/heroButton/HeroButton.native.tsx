/**
 * @module @commise/ui/hero-button — the native design-system {@link HeroButton} (see `props.ts`): regular, untinted,
 * interactive Liquid Glass on iOS 26, and a solid `photoChip` disc everywhere else, in the system's theme.
 *
 * The pressable takes a `ref` (React 19's plain prop) so a host can move the screen-reader cursor onto it, and reports
 * `aria-expanded` when the control opens something.
 *
 * Presentational: props → JSX. Which device it is on is read, not decided.
 *
 * @pattern Adapter over `expo-glass-effect`, with a solid fallback where the platform has no glass
 */
import { GlassView } from 'expo-glass-effect';
import type { FC, Ref } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { hasLiquidGlass } from '../chromeSurface/liquidGlass.native.js';
import { Icon } from '../icon/Icon.native.js';
import { useTheme } from '../theme/useTheme.native.js';
import type { HeroButtonProps } from './props.js';

/** The disc's diameter: the 44 pt minimum touch target, and the spec's size. */
const DISC_PX = 44;

/** The touch floor: 44 pt on iOS, 48 dp on Android ("every 44 is 48 dp there"). On Android a transparent frame carries it. */
const touchFloor = (): number => (Platform.OS === 'android' ? 48 : DISC_PX);

/** Native props: the shared contract plus the handle a screen-reader focus request needs. */
export interface HeroButtonNativeProps extends HeroButtonProps {
    /** The pressable, for moving the screen-reader cursor onto it. */
    readonly ref?: Ref<View>;
}

/** The native control over a photo. */
export const HeroButton: FC<HeroButtonNativeProps> = ({ icon, label, onPress, expanded, disabled = false, ref }) => {
    const { colors } = useTheme();
    const glyph = <Icon name={icon} size={24} tone="ink" />;
    const common = {
        ref,
        accessibilityRole: 'button' as const,
        accessibilityLabel: label,
        disabled,
        onPress,
        ...(expanded === undefined ? {} : { 'aria-expanded': expanded }),
    };

    const frame = { width: touchFloor(), height: touchFloor() };

    // The Pressable is the hit frame (48 dp on Android, the disc itself elsewhere); the disc is drawn inside it.
    return (
        <Pressable {...common} style={[styles.frame, frame]}>
            {hasLiquidGlass() ? (
                <View style={styles.disc}>
                    <GlassView glassEffectStyle="regular" isInteractive colorScheme="auto" style={styles.fill}>
                        {glyph}
                    </GlassView>
                </View>
            ) : (
                <View style={[styles.disc, styles.center, { backgroundColor: colors.photoChip }]}>{glyph}</View>
            )}
        </Pressable>
    );
};

const styles = StyleSheet.create({
    frame: { alignItems: 'center', justifyContent: 'center' },
    disc: { width: DISC_PX, height: DISC_PX, borderRadius: DISC_PX / 2, overflow: 'hidden' },
    center: { alignItems: 'center', justifyContent: 'center' },
    fill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
