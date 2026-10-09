/**
 * @module @commise/features-account/profile/ProfileValueRow — a read-only Profile row (native): the label and the
 * value the cook cannot change here. Not a control. Colour comes from the theme at render.
 *
 * Presentational: props → JSX.
 */
import { useTheme } from '@commise/ui/theme';
import { nativeTokens } from '@commise/ui/native';
import type { FC } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { ProfileValueRowProps } from './props.js';

/** A read-only row. The value wraps: an email is one unbroken string on a 320 pt screen. */
export const ProfileValueRow: FC<ProfileValueRowProps> = ({ label, value }) => {
    const { colors } = useTheme();

    return (
        <View style={styles.row}>
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
        gap: nativeTokens.spacing[4],
        paddingHorizontal: nativeTokens.spacing[4],
        paddingVertical: nativeTokens.spacing[2],
    },
    label: { ...nativeTokens.type.body, flexShrink: 0 },
    value: { ...nativeTokens.type.body, flexShrink: 1, textAlign: 'right' },
});
