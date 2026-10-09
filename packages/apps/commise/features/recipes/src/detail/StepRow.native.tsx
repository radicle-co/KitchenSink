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
import type { FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { fillTemplate } from '../list/model.js';
import { recipeMessages } from '../messages.js';
import type { StepRowProps } from './cookRowProps.js';
import { stepTimerLabel } from './model.js';

/** `dataSet` is a react-native-web runtime prop (→ DOM `data-*`) absent from react-native's `ViewProps`. */
const MarkedView = View as unknown as FC<
    React.ComponentProps<typeof View> & { readonly dataSet?: Record<string, string> }
>;

/** The native step row. */
export const StepRow: FC<StepRowProps> = ({ step, current, onToggle }) => {
    const { detail, duration } = useMessages(recipeMessages);
    const { colors } = useTheme();
    const timer = stepTimerLabel(step.timerSeconds, detail.stepTimer, duration);

    return (
        <Pressable accessible={false} onPress={() => onToggle(step.stepNumber)} style={styles.row}>
            {current ? (
                <MarkedView dataSet={{ hereBar: '' }} style={[styles.hereBar, { backgroundColor: colors.hereBar }]} />
            ) : null}
            <Pressable
                role="button"
                aria-pressed={current}
                accessibilityState={{ selected: current }}
                accessibilityLabel={fillTemplate(detail.stepToggleLabel, { step: step.stepNumber })}
                onPress={() => onToggle(step.stepNumber)}
                style={styles.toggle}
            >
                <View style={[styles.numeral, { backgroundColor: current ? colors.action : colors.selectedFill }]}>
                    <Text style={[styles.numeralText, { color: current ? colors.onAction : colors.ink }]}>
                        {step.stepNumber}
                    </Text>
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
    hereBar: { position: 'absolute', top: 0, bottom: 0, start: 0, width: 3, borderRadius: 2 },
    toggle: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    numeral: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
    numeralText: { ...nativeTokens.type.label, fontVariant: ['tabular-nums', 'lining-nums'] },
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
