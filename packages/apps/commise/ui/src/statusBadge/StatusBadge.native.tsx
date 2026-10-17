/**
 * @module @commise/ui/status-badge — the native badge that states a status (`Draft`, `Custom`, `Needs review`, …).
 *
 * React Native's nested `Text` takes no reliable radius or padding, so the badge is a `View` holding the glyph and a
 * `Text`, the same mechanism as `StandIn` (`docs/design/ingredientSpecialization.md` E2 I1). The same contract as the
 * web leaf: the words are the content, the badge is filled and never dashed, each status's label clears 4.5:1 on its
 * fill, the label wraps and is never cut off, and it is 24 pt tall with the `sm` radius.
 *
 * @pattern Registry consumer — the status picks its pair and glyph from closed `Record`s (`BADGE_GLYPH`, the tones)
 */
import type { FC } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Icon } from '../icon/Icon.native.js';
import type { Theme } from '../theme/themeFor.js';
import { useTheme } from '../theme/useTheme.native.js';
import { proTone } from '../tokens/tones.js';
import { nativeTokens } from '../tokens/native.js';
import { BADGE_GLYPH, type BadgeStatus, type StatusBadgeProps } from './props.js';

/**
 * Each status's fill and label in the current theme: the web leaf's pairs (see its note on the `attention` fallback).
 * The PRO pair is fixed in both themes (`darkTheme.md` §2); every other pair re-themes. Pure.
 */
function badgePair({ colors }: Theme, status: BadgeStatus): { readonly fill: string; readonly text: string } {
    switch (status) {
        case 'pro':
            return proTone;
        case 'note':
            return { fill: colors.surfaceMuted, text: colors.inkMuted };
        case 'attention':
            return { fill: colors.attentionTint, text: colors.ink };
        case 'draft':
        case 'private':
        case 'public':
        case 'soon':
            return { fill: colors.surfaceMuted, text: colors.ink };
    }
}

/** The status badge: filled, and as wide as its words allow. */
export const StatusBadge: FC<StatusBadgeProps> = ({ status, children }) => {
    const glyph = BADGE_GLYPH[status];
    const pair = badgePair(useTheme(), status);

    return (
        <View style={[styles.badge, { backgroundColor: pair.fill }]}>
            {glyph === null ? null : <Icon name={glyph} size={16} tone="ink" />}
            <Text style={[styles.label, { color: pair.text }]}>{children}</Text>
        </View>
    );
};

const styles = StyleSheet.create({
    badge: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: nativeTokens.spacing[1],
        maxWidth: '100%',
        minHeight: 24,
        borderRadius: nativeTokens.radius.sm,
        paddingHorizontal: nativeTokens.spacing[2],
        paddingVertical: 2,
    },
    label: { ...nativeTokens.type.caption, flexShrink: 1 },
});
