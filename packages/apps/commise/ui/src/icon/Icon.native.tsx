/**
 * @module @commise/ui/icon — the native design-system {@link Icon}.
 *
 * Draws the Registry's `lucide-react-native` glyph (rendered by `react-native-svg`) for a meaning, at Lucide's 2 px
 * stroke, outlined unless `filled`. A native glyph inherits no text colour, so it draws in the role named by `tone`,
 * `ink` when there is none. It sits in a view hidden from assistive tech unless the caller names it, in which case the
 * view is one accessible image with that name.
 *
 * A directional glyph is mirrored when React Native reports a right-to-left layout.
 *
 * @pattern Adapter over `lucide-react-native` — a screen names a meaning from the closed `IconName` Registry, never a
 *     glyph
 */
import type { FC } from 'react';
import { I18nManager, StyleSheet, View } from 'react-native';

import { useTheme } from '../theme/useTheme.native.js';
import { GLYPHS } from './glyphs.native.js';
import { MIRROR_IN_RTL, type IconProps } from './props.js';

/** The native design-system icon. */
export const Icon: FC<IconProps> = ({ name, size = 24, tone = 'ink', filled = false, label }) => {
    const Glyph = GLYPHS[name];
    // From the theme at render, so the glyph repaints in the dark scheme (D15).
    const color = useTheme().colors[tone];
    const mirrored = MIRROR_IN_RTL.has(name) && I18nManager.getConstants().isRTL;

    return (
        <View
            collapsable={false}
            style={[styles.box, mirrored ? styles.mirrored : null]}
            {...(label === undefined
                ? { 'aria-hidden': true }
                : { accessible: true, accessibilityRole: 'image' as const, accessibilityLabel: label })}
        >
            <Glyph size={size} color={color} strokeWidth={2} fill={filled ? color : 'none'} />
        </View>
    );
};

const styles = StyleSheet.create({
    box: { alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
    mirrored: { transform: [{ scaleX: -1 }] },
});
