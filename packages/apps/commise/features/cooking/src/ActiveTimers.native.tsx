/**
 * @module @commise/features-cooking/ActiveTimers — the native list of running timers (FR-034).
 *
 * The React Native leaf of the web {@link import('./ActiveTimers').ActiveTimers}: same
 * {@link ActiveTimersProps} contract, same Humble Object (`./timerModel`), same **Command-shaped** intent
 * surface — each control raises `onPause` / `onResume` / `onCancel` with the timer's OWN id, so the
 * orchestrator's reducer receives an addressed command rather than a positional one.
 *
 * Pattern: **pure presentational leaf** (`props → JSX`). No state, no interval, no ref; `remainingMs` is
 * computed upstream each frame.
 *
 * The two accessibility decisions mirror the web leaf exactly, so the platforms cannot drift:
 *  - each countdown is a real `timer` role (RN's own `AccessibilityRole`, so it is device-correct on
 *    VoiceOver/TalkBack), NAMED by the step's label, making concurrent timers individually addressable;
 *  - paused vs running rides on the toggle's VISIBLE TEXT — "Pause timer" vs "Resume timer" — plus a
 *    glyph and a dashed border. Colour is never the sole conveyor (NFR-004), which matters at the three
 *    feet SC-007 asks the surface to be readable from.
 *
 * Nothing here scales with yield: cook time is not a function of servings (FR-034a / spec D-002).
 */
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui/colors';
import { nativeTokens } from '@commise/ui/native';
import type { FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { cookingMessages } from './messages';
import { formatRemaining, type ActiveTimersProps } from './timerModel';

/** The list of timers the session is currently running — countdown, pause/resume and cancel, per timer. */
export const ActiveTimers: FC<ActiveTimersProps> = ({ timers, onPause, onResume, onCancel }) => {
    const messages = useMessages(cookingMessages);

    // No timers means no region at all — an empty labelled list would be chrome a screen reader has to
    // step through for nothing.
    if (timers.length === 0) {
        return null;
    }

    return (
        <View accessibilityRole="list" accessibilityLabel={messages.activeTimersLabel} style={styles.list}>
            {timers.map(({ timer, remainingMs }) => (
                // `role="listitem"` (RN's web-aligned `role` prop) — `AccessibilityRole` has no item
                // member, and an enumerable list whose children are not items is only half a list.
                <View
                    key={timer.id}
                    role="listitem"
                    style={[styles.row, timer.isPaused ? styles.rowPaused : styles.rowRunning]}
                >
                    {/* Decorative state glyph — a NON-colour pairing (NFR-004); the toggle's own text
                        label states the state in words for assistive tech. */}
                    <Text aria-hidden style={styles.glyph}>
                        {timer.isPaused ? '⏸' : '⏳'}
                    </Text>
                    <Text numberOfLines={1} style={styles.label}>
                        {timer.label}
                    </Text>
                    <View accessibilityRole="timer" accessibilityLabel={timer.label}>
                        <Text style={styles.countdown}>{formatRemaining(remainingMs, messages.timeRemaining)}</Text>
                    </View>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={timer.isPaused ? messages.resumeTimerLabel : messages.pauseTimerLabel}
                        onPress={() => (timer.isPaused ? onResume(timer.id) : onPause(timer.id))}
                        style={[styles.control, styles.toggleControl]}
                    >
                        <Text style={styles.toggleLabel}>
                            {timer.isPaused ? messages.resumeTimerLabel : messages.pauseTimerLabel}
                        </Text>
                    </Pressable>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={messages.cancelTimerLabel}
                        onPress={() => onCancel(timer.id)}
                        style={[styles.control, styles.cancelControl]}
                    >
                        <Text style={styles.cancelLabel}>{messages.cancelTimerLabel}</Text>
                    </Pressable>
                </View>
            ))}
        </View>
    );
};

const styles = StyleSheet.create({
    list: { width: '100%', gap: nativeTokens.spacing[3] },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: nativeTokens.spacing[3],
        borderRadius: nativeTokens.radius.lg,
        backgroundColor: palette.white,
        padding: nativeTokens.spacing[3],
    },
    rowRunning: { borderWidth: 1, borderColor: palette.mist },
    // A DASHED hairline, paired with the glyph and the "Resume timer" label — paused is legible without
    // perceiving colour (NFR-004).
    rowPaused: { borderWidth: 1, borderStyle: 'dashed', borderColor: palette.slate, opacity: 0.8 },
    glyph: { fontSize: nativeTokens.fontSize.headingSm, color: palette.slate },
    label: { flexShrink: 1, fontSize: nativeTokens.fontSize.bodyMd, fontWeight: '500', color: palette.charcoal },
    // `fontVariant: ['tabular-nums']` keeps the readout from jittering in width as the digits change.
    countdown: {
        fontSize: nativeTokens.fontSize.headingMd,
        fontWeight: '600',
        color: palette.charcoal,
        fontVariant: ['tabular-nums'],
    },
    // B10 — a >=44pt touch target (WCAG 2.5.5 / platform minimums); Cooking Mode is a hands-busy surface.
    control: {
        minWidth: 44,
        minHeight: 44,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: nativeTokens.radius.full,
        paddingHorizontal: nativeTokens.spacing[4],
    },
    toggleControl: { backgroundColor: palette.pearl },
    toggleLabel: { fontSize: nativeTokens.fontSize.bodySm, fontWeight: '600', color: palette.charcoal },
    cancelControl: { borderWidth: 1, borderColor: palette.error, backgroundColor: palette.white },
    cancelLabel: { fontSize: nativeTokens.fontSize.bodySm, fontWeight: '600', color: palette['error-dark'] },
});
