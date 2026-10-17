/**
 * @module @commise/features-recipes/editor — the native editor's resume notice (build spec §7.3): a published recipe has
 * device changes from an earlier visit. Same props as the web leaf; its text says what it is, so the card is unnamed
 * (`nativeContainerNames.md` N1).
 *
 * Presentational: props → JSX.
 */
import { Button } from '@commise/ui/button';
import { LiveRegion } from '@commise/ui/live-region';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { ResumeNoticeProps } from './frameProps.js';

/** A published recipe's device changes, waiting for Save changes. */
export const ResumeNotice: FC<ResumeNoticeProps> = ({
    body,
    saveLabel,
    discardLabel,
    onSave,
    onDiscard,
    discardUnavailable,
}) => {
    const { colors } = useTheme();

    return (
        <View style={[styles.card, { backgroundColor: colors.surfaceMuted }]}>
            <Text style={[styles.body, { color: colors.ink }]}>{body}</Text>
            <View style={styles.actions}>
                <Button size="sm" icon="check" onPress={onSave}>
                    {saveLabel}
                </Button>
                <Button size="sm" variant="ghost" disabled={discardUnavailable !== undefined} onPress={onDiscard}>
                    {discardLabel}
                </Button>
            </View>
            {discardUnavailable === undefined ? null : (
                <LiveRegion politeness="polite" style={[styles.reason, { color: colors.inkMuted }]}>
                    {discardUnavailable}
                </LiveRegion>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    card: { gap: nativeTokens.spacing[3], padding: nativeTokens.spacing[4], borderRadius: nativeTokens.radius.md },
    body: { ...nativeTokens.type.meta },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: nativeTokens.spacing[2] },
    reason: { ...nativeTokens.type.meta },
});
