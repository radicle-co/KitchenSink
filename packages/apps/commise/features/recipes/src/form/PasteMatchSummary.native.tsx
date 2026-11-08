/**
 * @module @commise/features-recipes/form — `PasteMatchSummary` (native): the React Native leaf of
 * `./PasteMatchSummary.tsx`, on the same props and words: "Added 8 lines", then one muted paragraph of the counts and the
 * rule, on the page rather than a fill card (U4). Painted from the theme's roles (D15).
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
        <View style={styles.block}>
            <Text style={[styles.added, { color: colors.ink }]}>{view.added}</Text>
            <Text style={[styles.paragraph, { color: colors.inkMuted }]}>{view.paragraph}</Text>
        </View>
    );
};

const styles = StyleSheet.create({
    block: { gap: nativeTokens.spacing[1] },
    added: { ...nativeTokens.type.body },
    paragraph: { ...nativeTokens.type.list },
});
