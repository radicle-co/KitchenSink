/**
 * @module @commise/features-recipes/editor — the native editor's alert for a write the outbox parked (build spec §7.8,
 * ADR-0057). Same props as the web leaf.
 *
 * Presentational: props → JSX.
 */
import { Button } from '@commise/ui/button';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { FailureAlertProps } from './frameProps.js';

/** A write the outbox parked: what happened, and what the cook can do. */
export const FailureAlert: FC<FailureAlertProps> = ({ body, primary, secondary }) => {
    const { colors } = useTheme();

    return (
        <View
            collapsable={false}
            role="alert"
            style={[styles.alert, { backgroundColor: colors.paper, borderColor: colors.lineControl }]}
        >
            <Text style={[styles.body, { color: colors.ink }]}>{body}</Text>
            <View style={styles.actions}>
                <Button size="sm" icon={primary.icon} onPress={primary.onPress}>
                    {primary.label}
                </Button>
                {secondary === undefined ? null : (
                    <Button size="sm" variant="secondary" icon={secondary.icon} onPress={secondary.onPress}>
                        {secondary.label}
                    </Button>
                )}
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    alert: {
        gap: nativeTokens.spacing[2],
        padding: nativeTokens.spacing[3],
        borderRadius: nativeTokens.radius.md,
        borderWidth: StyleSheet.hairlineWidth,
    },
    body: { ...nativeTokens.type.meta },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: nativeTokens.spacing[2] },
});
