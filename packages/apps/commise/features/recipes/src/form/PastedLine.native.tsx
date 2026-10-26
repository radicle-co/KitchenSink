/**
 * @module @commise/features-recipes/form — `PastedLine` (native): the React Native leaf of `./PastedLine.tsx`. The measure
 * is set in the semibold face of the `cardTitle` role rather than with a `fontWeight`, which Android would synthesise
 * (`nativeTokens.type`). Painted from the theme's roles (D15).
 */
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { StyleSheet, Text } from 'react-native';

import type { PastedLineProps } from './pastedLineProps.js';

/** The line as the cook wrote it. */
export const PastedLine: FC<PastedLineProps> = ({ line }) => {
    const { colors } = useTheme();

    return (
        <Text style={[styles.line, { color: colors.ink }]}>
            {line.measure !== '' && <Text style={styles.measure}>{line.measure}</Text>}
            {line.measure !== '' && ' '}
            {line.words}
        </Text>
    );
};

const styles = StyleSheet.create({
    line: { ...nativeTokens.type.body },
    measure: { fontFamily: nativeTokens.type.cardTitle.fontFamily },
});
