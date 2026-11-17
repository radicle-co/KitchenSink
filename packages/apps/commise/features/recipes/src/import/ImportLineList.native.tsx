/**
 * @module @commise/features-recipes/import — `ImportLineList` (native): the React Native leaf of `./ImportLineList.tsx`,
 * on the same props: the ONE shared matched-line list (`MatchLineList`) under the recipe-with-nothing-to-fix sentence.
 * Painted from the theme's roles (D15).
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { pluralOf } from '@commise/i18n';
import { isNothingToFix } from '../ingredientMatching/matchLine.js';
import { MatchLineList } from '../ingredientMatching/MatchLineList.native.js';
import { importMessages } from './messages.js';
import type { ImportLineListProps } from './props.js';

/** One imported recipe's lines, one open line expanded. */
export const ImportLineList: FC<ImportLineListProps> = (props) => {
    const { wizard } = useMessages(importMessages);
    const locale = useLocale();
    const { colors } = useTheme();

    return (
        <View style={styles.list}>
            {isNothingToFix(props.lines) ? (
                <Text style={[styles.body, { color: colors.inkMuted }]}>
                    {pluralOf(wizard.nothingToFix, props.lines.length, locale)}
                </Text>
            ) : null}
            <MatchLineList {...props} />
        </View>
    );
};

const styles = StyleSheet.create({
    list: { gap: nativeTokens.spacing[2] },
    body: nativeTokens.type.body,
});
