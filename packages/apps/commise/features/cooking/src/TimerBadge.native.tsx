/**
 * @module @commise/features-cooking/TimerBadge — the native per-step timer badge (FR-034).
 *
 * The React Native leaf of the web {@link import('./TimerBadge').TimerBadge}: same
 * {@link TimerBadgeProps} contract, same Humble Object (`./timerModel`), same structural gate — a step
 * with no (or a zero-length) duration renders NOTHING, so there is no dead affordance to prod at.
 *
 * Pattern: **pure presentational leaf** (`props → JSX`). No state, no interval, no ref; the countdown and
 * the timer's existence belong to the session orchestrator, which this leaf only signals via `onStart`.
 *
 * The duration is the step's own `timerSeconds`, unscaled — cook time does not scale with yield, so no
 * scale factor reaches this component (FR-034a / spec D-002). Tokens come from `@commise/ui`; the
 * dependency points feature → design system and never back.
 */
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui/colors';
import { nativeTokens } from '@commise/ui/native';
import type { FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { cookingMessages } from './messages';
import { formatRemaining, stepTimerDurationMs, type TimerBadgeProps } from './timerModel';

/** The per-step timer badge — the step's duration plus the control that starts counting it down. */
export const TimerBadge: FC<TimerBadgeProps> = ({ step, onStart }) => {
    const messages = useMessages(cookingMessages);
    const durationMs = stepTimerDurationMs(step);

    // A step with no (or a zero-length) duration renders NO badge — the gate is structural (FR-034).
    if (durationMs === undefined) {
        return null;
    }

    return (
        <View style={styles.row}>
            <View style={styles.badge}>
                {/* Decorative clock — a NON-colour pairing for the duration (NFR-004), hidden from AT so
                    the control's localized label alone owns the accessible name. */}
                <Text aria-hidden style={styles.glyph}>
                    ⏱
                </Text>
                <Text style={styles.duration}>{formatRemaining(durationMs, messages.timeRemaining)}</Text>
            </View>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={messages.startTimerLabel}
                onPress={() => onStart(step)}
                style={styles.startControl}
            >
                <Text style={styles.startLabel}>{messages.startTimerLabel}</Text>
            </Pressable>
        </View>
    );
};

const styles = StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: nativeTokens.spacing[3], flexWrap: 'wrap' },
    badge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: nativeTokens.spacing[2],
        borderRadius: nativeTokens.radius.full,
        borderWidth: 1,
        borderColor: palette.mist,
        backgroundColor: palette.white,
        paddingHorizontal: nativeTokens.spacing[4],
        paddingVertical: nativeTokens.spacing[2],
    },
    glyph: { fontSize: nativeTokens.fontSize.headingSm, color: palette.slate },
    // `fontVariant: ['tabular-nums']` keeps the readout from jittering in width as the digits change.
    duration: {
        fontSize: nativeTokens.fontSize.headingMd,
        fontWeight: '600',
        color: palette.charcoal,
        fontVariant: ['tabular-nums'],
    },
    // B10 — a >=44pt touch target (WCAG 2.5.5 / platform minimums); Cooking Mode is a hands-busy surface.
    startControl: {
        minWidth: 44,
        minHeight: 44,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: nativeTokens.radius.full,
        backgroundColor: palette.seafoam,
        paddingHorizontal: nativeTokens.spacing[5],
    },
    startLabel: { fontSize: nativeTokens.fontSize.bodyMd, fontWeight: '600', color: palette.white },
});
