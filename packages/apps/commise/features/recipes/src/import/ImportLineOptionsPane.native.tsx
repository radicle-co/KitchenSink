/**
 * @module @commise/features-recipes/import — `ImportLineOptionsPane` (native): the React Native leaf of
 * `./ImportLineOptionsPane.tsx`, beside the flagged list at the wide container class (1194): the line and its recipe as
 * a heading, then the same list the sheet shows, search first.
 */
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useChoiceListView } from '../ingredientMatching/useChoiceListView.js';
import { FoodChoiceList } from '../ingredientMatching/FoodChoiceList.native.js';
import type { ImportLineOptionsPaneProps } from './props.js';

/** A flagged line's options, as a pane. */
export const ImportLineOptionsPane: FC<ImportLineOptionsPaneProps> = ({ title, line, online, pending, ...list }) => {
    const view = useChoiceListView(line, { online, pending });
    const { colors } = useTheme();

    return (
        <View style={[styles.pane, { borderColor: colors.lineDivider, backgroundColor: colors.paper }]}>
            <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>
                {title}
            </Text>
            <FoodChoiceList view={view} {...list} />
        </View>
    );
};

const styles = StyleSheet.create({
    pane: {
        gap: nativeTokens.spacing[3],
        padding: nativeTokens.spacing[4],
        borderWidth: 1,
        borderRadius: nativeTokens.radius.md,
    },
    title: nativeTokens.type.sectionTitle,
});
