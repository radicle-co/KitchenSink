/**
 * @module @commise/features-recipes/collections — the native twin of the web `CollectionDetailAlert`: the line the
 * collection detail says when an action failed, as an alert in the danger text colour at the screen's gutter. The colour
 * is read from the theme at render.
 *
 * Presentational: props → JSX.
 */
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { StyleSheet, Text } from 'react-native';

import type { CollectionDetailAlertProps } from './CollectionDetailAlert.js';

export const CollectionDetailAlert: FC<CollectionDetailAlertProps> = ({ text }) => {
    const { colors } = useTheme();

    return (
        <Text role="alert" style={[styles.alert, { color: colors.dangerText }]}>
            {text}
        </Text>
    );
};

const styles = StyleSheet.create({
    alert: { paddingHorizontal: nativeTokens.spacing[4], paddingVertical: nativeTokens.spacing[2] },
});
