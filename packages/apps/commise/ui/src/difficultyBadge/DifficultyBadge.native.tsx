/**
 * @module @commise/ui/difficulty-badge — the native `DifficultyBadge`: a tint, a three-dot meter and the word, with its
 * colours read from the theme at render so it follows the system scheme.
 *
 * @pattern Registry consumer — the level picks its tint and meter fill from closed `Record`s
 */
import type { FC } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../theme/useTheme.native.js';
import { nativeTokens } from '../tokens/native.js';
import { difficultyTone, difficultyToneDark } from '../tokens/tones.js';
import { DIFFICULTY_METER, METER_DOTS, type DifficultyBadgeProps } from './props.js';

/**
 * A stated difficulty.
 *
 * @param props - The level and its word.
 * @returns The badge.
 */
export const DifficultyBadge: FC<DifficultyBadgeProps> = ({ level, children }) => {
    const tone = (useTheme().scheme === 'dark' ? difficultyToneDark : difficultyTone)[level];

    return (
        <View style={[styles.badge, { backgroundColor: tone.fill }]}>
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.meter}>
                {Array.from({ length: METER_DOTS }, (_unused, index) => {
                    const filled = index < DIFFICULTY_METER[level];

                    return (
                        <View
                            key={index}
                            // A data attribute, so a test can read the meter without a test id.
                            {...{ dataSet: { meterDot: filled ? 'filled' : 'empty' } }}
                            style={[
                                styles.dot,
                                { borderColor: tone.text, backgroundColor: filled ? tone.text : 'transparent' },
                            ]}
                        />
                    );
                })}
            </View>
            <Text numberOfLines={1} style={[styles.word, { color: tone.text }]}>
                {children}
            </Text>
        </View>
    );
};

const styles = StyleSheet.create({
    badge: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        flexShrink: 0,
        gap: nativeTokens.spacing[1],
        minHeight: 24,
        maxWidth: '100%',
        borderRadius: nativeTokens.radius.sm,
        paddingHorizontal: nativeTokens.spacing[2],
        paddingVertical: 2,
    },
    meter: { flexDirection: 'row', alignItems: 'center', gap: 2 },
    dot: { width: 6, height: 6, borderRadius: 3, borderWidth: 1 },
    word: { ...nativeTokens.type.caption, flexShrink: 1 },
});
