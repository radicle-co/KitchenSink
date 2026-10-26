/**
 * @module @commise/features-recipes/ingredientMatching — `MatchOpenRow` (native): the React Native leaf of
 * `./MatchOpenRow.tsx`, on the same props: the line, its muted prompt, then its `FoodChoiceList`. Its options sit in the
 * page's flow, below the line, within thumb reach. Painted from the theme's roles (D15).
 */
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { FoodChoiceList } from './FoodChoiceList.native.js';
import { MatchLineText } from './MatchLineText.native.js';
import type { MatchOpenRowProps } from './matchOpenRowProps.js';

/** The expanded line. */
export const MatchOpenRow: FC<MatchOpenRowProps> = ({ line, view, ...list }) => {
    const { colors } = useTheme();

    return (
        <View style={[styles.row, { borderColor: colors.lineDivider }]}>
            <View style={styles.head}>
                <MatchLineText line={line} />
                {view.prompt === undefined ? null : (
                    <Text style={[styles.prompt, { color: colors.inkMuted }]}>{view.prompt}</Text>
                )}
            </View>
            <FoodChoiceList view={view.list} {...list} />
        </View>
    );
};

const styles = StyleSheet.create({
    // An edge, not a fill: the options press to `surfaceMuted`, which a fill of the same colour would hide.
    row: {
        borderWidth: 1,
        gap: nativeTokens.spacing[2],
        paddingHorizontal: nativeTokens.spacing[3],
        paddingVertical: nativeTokens.spacing[3],
        borderRadius: nativeTokens.radius.md,
    },
    head: { gap: nativeTokens.spacing[1] },
    prompt: { ...nativeTokens.type.meta },
});
