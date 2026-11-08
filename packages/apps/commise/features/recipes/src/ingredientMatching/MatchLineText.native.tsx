/**
 * @module @commise/features-recipes/ingredientMatching — `MatchLineText` (native): the React Native leaf of
 * `./MatchLineText.tsx`, in the 16 px `body` role (the owner's type-scale ruling). The measure is set in the semibold face rather than with a
 * `fontWeight`, which Android would synthesise (`nativeTokens.type`). Painted from the theme's roles (D15).
 */
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { StyleSheet, Text } from 'react-native';

import type { MatchLineTextProps } from './matchLineTextProps.js';

/** The line as the cook wrote it. */
export const MatchLineText: FC<MatchLineTextProps> = ({ line }) => {
    const { colors } = useTheme();

    return (
        <Text style={[styles.line, { color: colors.ink }]}>
            {line.measure === '' ? null : <Text style={styles.measure}>{line.measure}</Text>}
            {line.measure === '' ? null : ' '}
            {line.words}
        </Text>
    );
};

const styles = StyleSheet.create({
    line: { ...nativeTokens.type.body },
    measure: { fontFamily: nativeTokens.fontFace.body.semibold },
});
