/**
 * @module @commise/features-cooking/TimerAlert — the native timer-completion banner (FR-034).
 *
 * The React Native leaf of the web {@link import('./TimerAlert').TimerAlert}: same
 * {@link TimerAlertProps} contract, same behaviour — a banner for the timer that just finished, and a
 * DISMISS intent. Pattern: **pure presentational leaf** (`props → JSX`). No sound, no timeout, no state.
 *
 * The audible chime is deliberately NOT here. Playing audio is a side effect, and a side effect in a
 * render component is what the design rules forbid; the orchestrator owns the timer engine, so it already
 * holds the fact this leaf is handed (`completedTimer`) at the moment it becomes true, and plays the
 * chime — and any haptic — from there. There is no audio prop for a pure component to ignore.
 *
 * The completion must be perceivable in a loud kitchen with busy hands, so it lands three ways: an
 * ASSERTIVE, atomic live region (React Native's `aria-live` is a first-class alias for
 * `accessibilityLiveRegion`, so this is device-correct on TalkBack rather than a web-only attribute), a
 * NON-colour visual (glyph + text, per NFR-004), and the orchestrator's chime.
 *
 * When nothing has completed the leaf renders NOTHING — an always-mounted empty live region invites
 * spurious announcements on unrelated re-renders.
 */
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui/colors';
import { nativeTokens } from '@commise/ui/native';
import type { FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { cookingMessages } from './messages';
import type { TimerAlertProps } from './timerModel';

/** The completion banner for a finished timer, with an assertive announcement and a dismiss control. */
export const TimerAlert: FC<TimerAlertProps> = ({ completedTimer, onDismiss }) => {
    const messages = useMessages(cookingMessages);

    // Nothing finished: render nothing, so there is no idle live region to announce into.
    if (completedTimer === undefined) {
        return null;
    }

    const announcement = messages.timerCompleteAnnouncement.replace('{label}', completedTimer.label);

    return (
        <View style={styles.banner}>
            {/* The live region is scoped to the ANNOUNCEMENT alone — the dismiss control is a sibling, so
                its label is not read out as part of the interruption. */}
            {/* No `aria-atomic` counterpart: React Native has no such prop, and none is needed — an
                Android live region announces its WHOLE content on change, which is what atomic means. */}
            <View accessibilityRole="alert" aria-live="assertive" style={styles.announcement}>
                {/* Decorative bell — a NON-colour pairing for the alert (NFR-004), hidden from AT. */}
                <Text aria-hidden style={styles.glyph}>
                    🔔
                </Text>
                <Text style={styles.announcementText}>{announcement}</Text>
            </View>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={messages.dismissAlertLabel}
                onPress={() => onDismiss(completedTimer.id)}
                style={styles.dismissControl}
            >
                <Text style={styles.dismissLabel}>{messages.dismissAlertLabel}</Text>
            </Pressable>
        </View>
    );
};

const styles = StyleSheet.create({
    banner: {
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: nativeTokens.spacing[3],
        width: '100%',
        borderRadius: nativeTokens.radius.lg,
        borderWidth: 2,
        borderColor: palette.warning,
        backgroundColor: palette.white,
        padding: nativeTokens.spacing[4],
    },
    announcement: {
        flexDirection: 'row',
        alignItems: 'center',
        flexShrink: 1,
        gap: nativeTokens.spacing[3],
    },
    glyph: { fontSize: nativeTokens.fontSize.headingMd },
    announcementText: {
        flexShrink: 1,
        fontSize: nativeTokens.fontSize.bodyLg,
        fontWeight: '600',
        color: palette.charcoal,
    },
    // B10 — a >=44pt touch target (WCAG 2.5.5 / platform minimums); Cooking Mode is a hands-busy surface.
    dismissControl: {
        minWidth: 44,
        minHeight: 44,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: nativeTokens.radius.full,
        backgroundColor: palette.pearl,
        paddingHorizontal: nativeTokens.spacing[5],
    },
    dismissLabel: { fontSize: nativeTokens.fontSize.bodyMd, fontWeight: '600', color: palette.charcoal },
});
