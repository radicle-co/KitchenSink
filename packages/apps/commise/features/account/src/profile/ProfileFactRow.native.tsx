/**
 * @module @commise/features-account/profile/ProfileFactRow — a read-only Profile row (native): the label and a value the
 * cook cannot change here (their username and email, which Clerk owns). It is text, not a control: no button role, no
 * chevron, no press fill. It is ONE accessibility element, so a screen reader reads the label and the value together in a
 * single swipe. The value takes the room the label leaves and wraps, so a long email never runs off the screen.
 *
 * Presentational: props → JSX.
 */
import { nativeTokens } from '@commise/ui/native';
import { Text } from '@commise/ui/text';
import type { FC } from 'react';
import { StyleSheet, View } from 'react-native';

import type { ProfileFactRowProps } from './props.js';

/** The read-only row. */
export const ProfileFactRow: FC<ProfileFactRowProps> = ({ label, value }) => (
    <View accessible style={styles.row}>
        <Text typeRole="body" color="$ink">
            {label}
        </Text>
        <Text typeRole="body" color="$inkMuted" flexShrink={1} textAlign="right">
            {value}
        </Text>
    </View>
);

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
});
