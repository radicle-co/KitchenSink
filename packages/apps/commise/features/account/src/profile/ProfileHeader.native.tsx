/**
 * @module @commise/features-account/profile/ProfileHeader — the Profile page's identity block (native): a 72 pt avatar
 * disc, the display name and the email (`buildSpec.md` §9.1, §3.8). The cook's photo (`AvatarField`) stays an app-level
 * native control; this block draws the disc.
 *
 * Three states, never a blocked page: loading is a skeleton, ready is the name and email, failed shows the `user`
 * glyph and says so with a Try again control. Colour comes from the theme at render.
 *
 * @pattern Visitor — an exhaustive switch over the profile read's three states
 */
import { Button } from '@commise/ui/button';
import { Icon } from '@commise/ui/icon';
import { useTheme } from '@commise/ui/theme';
import { nativeTokens } from '@commise/ui/native';
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { profileMessages } from './messages.js';
import type { ProfileHeaderProps } from './props.js';

/** The identity block. */
export const ProfileHeader: FC<ProfileHeaderProps> = ({ read, initials, onRetry }) => {
    const t = useMessages(profileMessages);
    const { colors } = useTheme();

    switch (read.status) {
        case 'loading':
            return (
                <View role="status" aria-label={t.loading} collapsable={false} style={styles.row}>
                    <View aria-hidden style={[styles.disc, { backgroundColor: colors.surfaceMuted }]} />
                    <View aria-hidden style={styles.skeletonText}>
                        <View style={[styles.line, { width: 160, backgroundColor: colors.surfaceMuted }]} />
                        <View style={[styles.line, { width: 224, backgroundColor: colors.surfaceMuted }]} />
                    </View>
                </View>
            );
        case 'failed':
            return (
                <View style={styles.row}>
                    <View aria-hidden style={[styles.disc, { backgroundColor: colors.surfaceMuted }]}>
                        <Icon name="user" size={24} tone="inkMuted" />
                    </View>
                    <View style={styles.text}>
                        <Text role="alert" style={[styles.name, { color: colors.ink }]}>
                            {t.loadError}
                        </Text>
                        <Button variant="secondary" size="sm" icon="rotateCcw" onPress={onRetry}>
                            {t.retry}
                        </Button>
                    </View>
                </View>
            );
        case 'ready':
            return (
                <View style={styles.row}>
                    <View
                        aria-hidden
                        style={[
                            styles.disc,
                            { backgroundColor: initials === '' ? colors.surfaceMuted : colors.action },
                        ]}
                    >
                        {initials === '' ? (
                            <Icon name="user" size={24} tone="inkMuted" />
                        ) : (
                            <Text style={[styles.initials, { color: colors.onAction }]}>{initials}</Text>
                        )}
                    </View>
                    <View style={styles.text}>
                        {read.displayName === '' ? null : (
                            <Text style={[styles.name, { color: colors.ink }]}>{read.displayName}</Text>
                        )}
                        <Text style={[styles.email, { color: colors.inkMuted }]}>{read.email}</Text>
                    </View>
                </View>
            );
    }
};

const styles = StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: nativeTokens.spacing[4] },
    disc: {
        width: 72,
        height: 72,
        borderRadius: nativeTokens.radius.full,
        alignItems: 'center',
        justifyContent: 'center',
    },
    initials: { ...nativeTokens.type.figureStat },
    text: { flex: 1, minWidth: 0, gap: nativeTokens.spacing[1], alignItems: 'flex-start' },
    skeletonText: { gap: nativeTokens.spacing[2] },
    line: { height: 16, borderRadius: nativeTokens.radius.sm },
    name: { ...nativeTokens.type.sectionTitle },
    email: { ...nativeTokens.type.meta },
});
