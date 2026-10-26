/**
 * @module @commise/features-recipes/ingredientMatching — `MatchFailureLine` (native): the React Native leaf of
 * `./MatchFailureLine.tsx`, on the same props: the warning glyph, the attention sentence in the 14 px `list` role, then
 * Try again, wrapping under it rather than squeezing at 320 pt. Painted from the theme's roles (D15).
 */
import { Button } from '@commise/ui/button';
import { Icon } from '@commise/ui/icon';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { MatchFailureLineProps } from './matchFailureLineProps.js';

/** A send that did not save, and Try again. */
export const MatchFailureLine: FC<MatchFailureLineProps> = ({ failure, onRetry }) => {
    const { colors } = useTheme();

    return (
        <View style={styles.line}>
            <View style={styles.sentence}>
                <Icon name="triangleAlert" size={16} tone="attention" />
                <Text style={[styles.text, { color: colors.attention }]}>{failure.text}</Text>
            </View>
            <Button
                variant="ghost"
                size="sm"
                icon="refreshCw"
                accessibilityLabel={failure.retry.name}
                onPress={onRetry}
            >
                {failure.retry.label}
            </Button>
        </View>
    );
};

const styles = StyleSheet.create({
    line: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: nativeTokens.spacing[2] },
    sentence: { flexDirection: 'row', alignItems: 'center', gap: nativeTokens.spacing[2], flexShrink: 1 },
    text: { ...nativeTokens.type.list, flexShrink: 1 },
});
