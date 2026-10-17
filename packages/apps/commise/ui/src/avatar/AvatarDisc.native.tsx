/**
 * @module @commise/ui/avatar — the native avatar's 32 pt disc, alone (`buildSpec.md` §3.3, §3.8). Decorative: the
 * control it sits in carries the name. Colours come from the theme at render.
 *
 * Presentational: props → JSX.
 *
 * @pattern Visitor — an exhaustive switch over the disc's three faces
 */
import type { FC } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Icon } from '../icon/Icon.native.js';
import type { Theme } from '../theme/themeFor.js';
import { useTheme } from '../theme/useTheme.native.js';
import { nativeTokens } from '../tokens/native.js';
import { avatarFaceOf, type AvatarDiscProps } from './props.js';

/** The disc's fill per face: initials on `action`, everything else on `surfaceMuted`. Pure. */
function discFill({ colors }: Theme, face: ReturnType<typeof avatarFaceOf>): string {
    return face === 'initials' ? colors.action : colors.surfaceMuted;
}

/** The 32 pt disc, decorative: the control it sits in carries the name. */
export const AvatarDisc: FC<AvatarDiscProps> = ({ status, initials }) => {
    const theme = useTheme();
    const face = avatarFaceOf({ status, initials });

    return (
        <View aria-hidden style={[styles.disc, { backgroundColor: discFill(theme, face) }]}>
            {face === 'initials' ? (
                <Text style={[styles.initials, { color: theme.colors.onAction }]}>{initials}</Text>
            ) : null}
            {face === 'glyph' ? <Icon name="user" size={20} tone="inkMuted" /> : null}
        </View>
    );
};

const styles = StyleSheet.create({
    disc: {
        width: 32,
        height: 32,
        borderRadius: nativeTokens.radius.full,
        alignItems: 'center',
        justifyContent: 'center',
    },
    initials: { ...nativeTokens.type.label },
});
