/**
 * @module @commise/features-recipes/form — `RecipeVisibilityStatement` (native), the React Native leaf of
 * `./RecipeVisibilityStatement.tsx`: "Who can see it: Public", shown in place of the visibility field when Private is
 * not offered (plan 2026-10-14-009 D14).
 *
 * ONE accessible element, named by the whole sentence, so a screen reader reads it once rather than three fragments.
 * Colours come from the theme at render, so both colour schemes paint (owner D15).
 */
import { useMessages } from '@commise/i18n/react';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { editorMessages } from '../editor/messages.js';

/** "Who can see it: Public". */
export const RecipeVisibilityStatement: FC = () => {
    const { visibility: v } = useMessages(editorMessages);
    const { colors } = useTheme();

    return (
        <View accessible aria-label={`${v.legend}: ${v.public}. ${v.publicHint}.`} style={styles.statement}>
            <Text style={[styles.legend, { color: colors.inkMuted }]}>{v.legend}</Text>
            <Text style={[styles.value, { color: colors.ink }]}>{v.public}</Text>
            <Text style={[styles.hint, { color: colors.inkMuted }]}>{v.publicHint}</Text>
        </View>
    );
};

const styles = StyleSheet.create({
    statement: { gap: nativeTokens.spacing[1] },
    legend: nativeTokens.type.label,
    value: nativeTokens.type.cardTitle,
    hint: nativeTokens.type.meta,
});
