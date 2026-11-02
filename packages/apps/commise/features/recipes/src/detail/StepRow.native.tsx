'use client';

/**
 * @module @commise/features-recipes — the native step row (build spec §6.1, §6.3): the mirror of `StepRow.tsx`.
 *
 * The step text stays content; the numeral is its own 44 pt `button` with a selected state, named "Mark step {n} as
 * current". A press anywhere else on the step activates the same toggle for touch users through an outer pressable
 * that is NOT an accessibility element, so a screen reader meets the text and the one button rather than a button
 * that swallows the text. The current step shows the 3 pt `hereBar` and fills its numeral with `action`.
 *
 * Presentational: props → JSX.
 */
import { useMessages } from '@commise/i18n/react';
import { Icon } from '@commise/ui/icon';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import { touchFloor } from '@commise/ui/layout';
import { Text as DesignText } from '@commise/ui/text';
import type { FC } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { fillTemplate } from '../format/fillTemplate.js';
import { numeralDiscOf } from '../format/numeralDisc.js';
import { recipeMessages } from '../messages.js';
import type { StepRowProps } from './cookRowProps.js';
import { stepTimerLabel } from './model.js';

/** The native step row. */
export const StepRow: FC<StepRowProps> = ({ step, current, onToggle }) => {
    const { detail, duration } = useMessages(recipeMessages);
    const { colors } = useTheme();
    // The numeral caps at 1.5x and its circle grows with it (designer ruling 2026-11-03).
    const disc = numeralDiscOf('caption', useWindowDimensions().fontScale);
    const timer = stepTimerLabel(step.timerSeconds, detail.stepTimer, duration);

    return (
        <Pressable accessible={false} onPress={() => onToggle(step.stepNumber)} style={styles.row}>
            {current ? <View style={[styles.hereBar, { backgroundColor: colors.hereBar }]} /> : null}
            <Pressable
                role="button"
                aria-pressed={current}
                accessibilityState={{ selected: current }}
                accessibilityLabel={fillTemplate(detail.stepToggleLabel, { step: step.stepNumber })}
                onPress={() => onToggle(step.stepNumber)}
                style={styles.toggle}
            >
                <View
                    style={[
                        styles.numeral,
                        {
                            minWidth: disc,
                            minHeight: disc,
                            borderRadius: disc / 2,
                            backgroundColor: current ? colors.action : colors.selectedFill,
                        },
                    ]}
                >
                    <DesignText typeRole="caption" chromeCap="1.5" figures color={current ? '$onAction' : '$ink'}>
                        {step.stepNumber}
                    </DesignText>
                </View>
            </Pressable>
            <View style={styles.body}>
                <Text style={[styles.text, { color: colors.ink }]}>{step.instruction}</Text>
                {timer !== undefined && (
                    <View style={[styles.timer, { backgroundColor: colors.surfaceMuted }]}>
                        <Icon name="timer" size={16} label={detail.stepTimerIcon} />
                        <Text style={[styles.timerText, { color: colors.ink }]}>{timer}</Text>
                    </View>
                )}
            </View>
        </Pressable>
    );
};

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: nativeTokens.spacing[3],
        paddingStart: nativeTokens.spacing[3],
    },
    hereBar: { position: 'absolute', top: 0, bottom: 0, start: 0, width: 3, borderRadius: nativeTokens.radius.full },
    toggle: { width: touchFloor(), height: touchFloor(), alignItems: 'center', justifyContent: 'center' },
    numeral: { alignItems: 'center', justifyContent: 'center' },
    body: { flex: 1, minWidth: 0, gap: nativeTokens.spacing[2], paddingTop: nativeTokens.spacing[2] },
    text: { ...nativeTokens.type.readingBody },
    timer: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: nativeTokens.spacing[1],
        borderRadius: nativeTokens.radius.sm,
        paddingHorizontal: nativeTokens.spacing[2],
        paddingVertical: 2,
    },
    timerText: { ...nativeTokens.type.meta },
});
