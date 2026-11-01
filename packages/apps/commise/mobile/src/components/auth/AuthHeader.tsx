/**
 * @module components/auth/AuthHeader — the top of both signed-out screens, in the order `buildSpec.md` §8 gives: the
 * mark, the H1, then the brand line under it. Sign-in and sign-up differ only in the H1, so the order and the roles
 * live here once.
 *
 * Colour comes from the theme at render, so both screens follow the system scheme.
 *
 * Presentational: props → JSX.
 */
import { authSurfaceMessages } from '@commise/features-account';
import { useMessages } from '@commise/i18n/react';
import { nativeTokens } from '@commise/ui/native';
import { Text } from '@commise/ui/text';
import type { JSX } from 'react';
import { StyleSheet, View } from 'react-native';

import { mobileMessages } from '../../i18n/messages.js';

/** Props for {@link AuthHeader}. */
export interface AuthHeaderProps {
    /** The screen's H1. */
    readonly title: string;
}

/**
 * @param props - The H1.
 * @returns The mark, the H1 and the brand line.
 */
export function AuthHeader({ title }: AuthHeaderProps): JSX.Element {
    const { auth } = useMessages(mobileMessages);
    const shared = useMessages(authSurfaceMessages);

    return (
        <View style={styles.header}>
            <Text typeRole="sectionTitle">{auth.brand}</Text>
            <Text typeRole="largeTitle" role="heading" aria-level={1}>
                {title}
            </Text>
            <Text typeRole="body" color="$inkMuted">
                {shared.brandLine}
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    header: { gap: nativeTokens.spacing[2] },
});
