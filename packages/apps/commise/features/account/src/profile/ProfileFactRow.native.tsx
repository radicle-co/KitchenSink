/**
 * @module @commise/features-account/profile/ProfileFactRow — a read-only Profile row (native): the label and a value the
 * cook cannot change here (their username and email, which Clerk owns). It is text, not a control: no button role, no
 * chevron, no press fill. It is ONE accessibility element, so a screen reader reads the label and the value together in a
 * single swipe. The value takes the room the label leaves and wraps, so a long email never runs off the screen.
 *
 * Presentational: props → JSX.
 */
import { useTheme } from '@commise/ui/theme';
import { nativeTokens } from '@commise/ui/native';
import type { FC } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { ProfileFactRowProps } from './props.js';

/** The read-only row. */
export const ProfileFactRow: FC<ProfileFactRowProps> = ({ label, value }) => {
    const { colors } = useTheme();

    return (
        <View accessible style={styles.row}>
            <Text style={[styles.label, { color: colors.ink }]}>{label}</Text>
            <Text style={[styles.value, { color: colors.inkMuted }]}>{value}</Text>
        </View>
    );
};

const styles = StyleSheet.create({
    row: {
        minHeight: 56,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: nativeTokens.spacing[3],
        paddingHorizontal: nativeTokens.spacing[4],
        paddingVertical: nativeTokens.spacing[2],
    },
    label: { ...nativeTokens.type.body },
    value: { ...nativeTokens.type.body, flexShrink: 1, textAlign: 'right' },
});
