/**
 * @module @commise/features-account/profile/ProfileHeader — the Profile page's identity block (native): a 72 pt avatar,
 * and the display name, or the @username when the cook has no name (owner ruling T8, 2026-10-29). The email shows only in
 * the Account group (owner ruling S2, 2026-10-27). The cook's photo control (`AvatarField`) stays an
 * app-level native control; the host passes it as `avatar` and it replaces the initials disc, so there is one avatar.
 *
 * Three states, never a blocked page: loading is a skeleton, ready is the avatar and the name, failed shows the `user`
 * glyph and says so with a Try again control. The text is the design system's capped `Text` in theme colour keys
 * (ADR-0080); the discs' and the skeleton's fills come from the theme at render.
 *
 * @pattern Visitor — an exhaustive switch over the profile read's three states
 */
import { Button } from '@commise/ui/button';
import { Icon } from '@commise/ui/icon';
import { Text } from '@commise/ui/text';
import { useTheme } from '@commise/ui/theme';
import { nativeTokens } from '@commise/ui/native';
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';
import { StyleSheet, View } from 'react-native';

import { profileMessages } from './messages.js';
import { profileHeaderTitleOf } from './model.js';
import type { ProfileHeaderProps } from './props.js';

/** The identity block. */
export const ProfileHeader: FC<ProfileHeaderProps> = ({ read, initials, onRetry, avatar }) => {
    const t = useMessages(profileMessages);
    const { colors } = useTheme();

    switch (read.status) {
        case 'loading':
            return (
                <View role="status" aria-label={t.loading} collapsable={false} style={styles.row}>
                    <View aria-hidden style={[styles.disc, { backgroundColor: colors.surfaceMuted }]} />
                    <View aria-hidden style={[styles.line, { width: 160, backgroundColor: colors.surfaceMuted }]} />
                </View>
            );
        case 'failed':
            return (
                <View style={styles.row}>
                    <View aria-hidden style={[styles.disc, { backgroundColor: colors.surfaceMuted }]}>
                        <Icon name="user" size={24} tone="inkMuted" />
                    </View>
                    <View style={styles.text}>
                        <Text role="alert" typeRole="body" color="$ink">
                            {t.loadError}
                        </Text>
                        <Button variant="quiet" icon="refreshCw" onPress={onRetry}>
                            {t.retry}
                        </Button>
                    </View>
                </View>
            );

        case 'ready': {
            const title = profileHeaderTitleOf(read, t.usernameValue);

            return (
                <View style={styles.row}>
                    {avatar ?? (
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
                                <Text typeRole="figureStat" color="$onAction">
                                    {initials}
                                </Text>
                            )}
                        </View>
                    )}
                    <View style={styles.text}>
                        {title === '' ? null : (
                            <Text typeRole="sectionTitle" color="$ink">
                                {title}
                            </Text>
                        )}
                    </View>
                </View>
            );
        }
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
    text: { flex: 1, minWidth: 0, gap: nativeTokens.spacing[1], alignItems: 'flex-start' },
    line: { height: 16, borderRadius: nativeTokens.radius.sm },
});
