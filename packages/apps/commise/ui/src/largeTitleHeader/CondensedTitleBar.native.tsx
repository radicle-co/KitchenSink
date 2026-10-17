/**
 * @module @commise/ui/large-title-header — the native design-system {@link CondensedTitleBar} (see `props.ts`): the
 * 56 pt bar every native screen lays over the top of its scroller, shown once the large title scrolls under the top. It
 * sits on the floating layer — Liquid Glass on iOS 26, a solid `paperRaised` surface elsewhere (`ChromeSurface`). It
 * sits at the top of its screen's SAFE-AREA frame, which already clears the status bar, so it adds no inset of its own
 * (measured on a device: padding the inset again drew a 56 pt bar twice as tall, below the status bar).
 *
 * ⛔ It hides by `ChromeSurface`'s own `visible` and by the TITLE's opacity, never by an opacity on this bar: an opacity
 * on a `GlassView`'s ancestor stops the glass rendering at all. A hidden bar takes no touches and is hidden from
 * assistive tech; the large header's own controls are on screen then.
 *
 * Presentational: props → JSX; `visible` is display derivation.
 *
 * @pattern Composite — the back control, the title and the menu over one floating-layer material
 */
import type { FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ChromeSurface } from '../chromeSurface/ChromeSurface.native.js';
import { Icon } from '../icon/Icon.native.js';
import { useTheme } from '../theme/useTheme.native.js';
import { nativeTokens } from '../tokens/native.js';
import type { CondensedTitleBarProps } from './props.js';

/** The bar's height under the status bar, pt (§3.3). */
const BAR_HEIGHT = 56;

/** The native design-system condensed title bar. */
export const CondensedTitleBar: FC<CondensedTitleBarProps> = ({ title, back, menu, visible }) => {
    const { colors } = useTheme();

    return (
        <View pointerEvents={visible ? 'box-none' : 'none'} aria-hidden={!visible} style={styles.bar}>
            <ChromeSurface edge="bottom" visible={visible} />
            {back === undefined ? null : (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={back.label}
                    onPress={back.onPress}
                    style={styles.back}
                >
                    <Icon name="chevronLeft" size={24} tone="actionText" />
                </Pressable>
            )}
            <Text
                numberOfLines={1}
                // The H1 says it; the bar repeats it for sight only.
                aria-hidden
                style={[styles.title, nativeTokens.type.barTitle, { color: colors.ink, opacity: visible ? 1 : 0 }]}
            >
                {title}
            </Text>
            {menu}
        </View>
    );
};

const styles = StyleSheet.create({
    bar: {
        position: 'absolute',
        top: 0,
        start: 0,
        end: 0,
        zIndex: 10,
        height: BAR_HEIGHT,
        flexDirection: 'row',
        alignItems: 'center',
        gap: nativeTokens.spacing[2],
        paddingHorizontal: nativeTokens.spacing[2],
    },
    back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    title: { flex: 1, paddingHorizontal: nativeTokens.spacing[2] },
});
