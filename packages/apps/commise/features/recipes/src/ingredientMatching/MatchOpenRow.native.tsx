/**
 * @module @commise/features-recipes/ingredientMatching — `MatchOpenRow` (native): the React Native leaf of
 * `./MatchOpenRow.tsx`, on the same props: the line, its muted prompt, a choice that did not save with Try again, then
 * its `FoodChoiceList`. Its options sit in the page's flow, below the line, within thumb reach. Not a card of its own
 * (U2): `MatchLineList` draws the rule above it, and the options' box carries the only border. Painted from the theme's
 * roles (D15).
 */
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { FoodChoiceList } from './FoodChoiceList.native.js';
import { MatchFailureLine } from './MatchFailureLine.native.js';
import { MatchLineText } from './MatchLineText.native.js';
import type { MatchOpenRowProps } from './matchOpenRowProps.js';

/** The expanded line. */
export const MatchOpenRow: FC<MatchOpenRowProps> = ({ line, view, onRetryPick, retry, ...list }) => {
    const { colors } = useTheme();

    return (
        <View style={styles.row}>
            <View style={styles.head}>
                <MatchLineText line={line} />
                {view.prompt === undefined ? null : (
                    <Text style={[styles.prompt, { color: colors.inkMuted }]}>{view.prompt}</Text>
                )}
                {view.failure === undefined ? null : (
                    <MatchFailureLine failure={view.failure} onRetry={onRetryPick} focus={retry.tryAgain} />
                )}
            </View>
            <FoodChoiceList view={view.list} landing={retry.landing} {...list} />
        </View>
    );
};

const styles = StyleSheet.create({
    row: { gap: nativeTokens.spacing[2], paddingVertical: nativeTokens.spacing[3] },
    head: { gap: nativeTokens.spacing[1] },
    prompt: { ...nativeTokens.type.list },
});
