/**
 * @module @commise/features-recipes/form — `PasteMatchSummary` (native): the React Native leaf of
 * `./PasteMatchSummary.tsx`, on the same props and words. Painted from the theme's roles (D15).
 */
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { PasteMatchSummaryProps } from './pasteMatchSummaryProps.js';

/** The summary above the pasted lines. */
export const PasteMatchSummary: FC<PasteMatchSummaryProps> = ({ view }) => {
    const { colors } = useTheme();

    return (
        <View style={[styles.block, { backgroundColor: colors.surfaceMuted }]}>
            <Text style={[styles.added, { color: colors.ink }]}>{view.added}</Text>
            {view.counts !== '' && <Text style={[styles.meta, { color: colors.inkMuted }]}>{view.counts}</Text>}
            <Text style={[styles.meta, { color: colors.inkMuted }]}>{view.rule}</Text>
        </View>
    );
};

const styles = StyleSheet.create({
    block: {
        gap: nativeTokens.spacing[1],
        paddingHorizontal: nativeTokens.spacing[3],
        paddingVertical: nativeTokens.spacing[3],
        borderRadius: nativeTokens.radius.md,
    },
    added: { ...nativeTokens.type.body },
    meta: { ...nativeTokens.type.meta },
});
