/**
 * @module @commise/features-cooking/VoiceControlToggle — the NATIVE voice-control toggle (US-006 / D-004).
 *
 * The React Native leaf of `VoiceControlToggle.tsx`: same {@link VoiceControlToggleProps} contract, same
 * {@link voiceControlModel} policy, same four states — so the two platforms cannot drift on when the
 * microphone may be opened or on how a refusal is explained. Pure `props → JSX`: no session state, no
 * recogniser, no fetching, no mutation, no refs.
 *
 * **This control IS the consent.** The OS permission dialog is raised by the adapter the hook starts, and
 * the hook starts it only from this press. Nothing here opens a microphone by mounting.
 *
 * **Accessibility parity is expressed twice, deliberately.** The pressed and disabled facts are carried
 * BOTH by `accessibilityState` (the trait the device announces) and by the form react-native-web projects
 * to the DOM — `accessibilityState` reaches no DOM attribute there, which is what the repo's
 * `accessibilityStateNeedsAriaSibling` lint rule exists to catch. For `pressed` that projection is
 * `aria-pressed`; for `disabled` it is the `disabled` PROP, because RNW's `Pressable` writes its own
 * `aria-disabled` from that prop and overwrites anything passed in. The accessible NAME is stated from the
 * same template the web leaf uses, so the two platforms announce the same string; the glyph is
 * `aria-hidden` and varies in SHAPE, and the state is always stated in words (NFR-004).
 *
 * The two settled states ({@link canToggleVoiceControl}) are wired to NO `onPress` — a structural no-op —
 * and keep their explanation rendered as a `status` rather than disappearing from the header.
 */
import { useMessages } from '@commise/i18n/react';
import { nativeTokens } from '@commise/ui/native';
import { palette } from '@commise/ui/tokens/colors';
import type { FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { cookingMessages } from './messages';
import {
    canToggleVoiceControl,
    formatVoiceControlName,
    type VoiceControlState,
    type VoiceControlToggleProps,
} from './voiceControlModel';

/**
 * One glyph per state, distinguished by SHAPE (hollow / filled / struck through) rather than tone, so the
 * state survives a monochrome or low-vision reading. A total {@link Record}: a new state fails to compile.
 */
const STATE_GLYPH: Readonly<Record<VoiceControlState, string>> = {
    idle: '○',
    listening: '◉',
    denied: '⊘',
    unsupported: '⊘',
};

/** The opt-in voice-control toggle shown in Cooking Mode's header (US-006). */
export const VoiceControlToggle: FC<VoiceControlToggleProps> = ({ state, onToggle }) => {
    const messages = useMessages(cookingMessages);

    const stateLabel: Readonly<Record<VoiceControlState, string>> = {
        idle: messages.voiceIdleLabel,
        listening: messages.voiceListeningLabel,
        denied: messages.voiceDeniedLabel,
        unsupported: messages.voiceUnavailableLabel,
    };
    const stateHint: Readonly<Record<VoiceControlState, string | null>> = {
        idle: null,
        listening: null,
        denied: messages.voiceDeniedHint,
        unsupported: messages.voiceUnavailableHint,
    };

    const operable = canToggleVoiceControl(state);
    const listening = state === 'listening';
    const hint = stateHint[state];

    return (
        <View style={styles.container}>
            <Pressable
                accessibilityRole="button"
                // Stated rather than computed from the Text children: react-native-web's name calculation
                // joined them WITHOUT a separator while the DOM's joined them with one, so the same
                // control announced two different names on the two platforms.
                accessibilityLabel={formatVoiceControlName(
                    messages.voiceControlName,
                    messages.voiceControlLabel,
                    stateLabel[state],
                )}
                // The device trait AND its web projection: `accessibilityState` alone is silent on
                // react-native-web, and `aria-pressed` alone is not reverse-mapped for the device.
                accessibilityState={{ selected: listening, disabled: !operable }}
                aria-pressed={listening}
                // `disabled` rather than a bare `aria-disabled`: react-native-web's `Pressable` writes its
                // OWN `aria-disabled` from this prop AFTER spreading the rest, so an `aria-disabled` passed
                // here is silently overwritten and the web build announces an enabled control.
                disabled={!operable}
                // No handler when the answer is settled: the no-op is STRUCTURAL, not a runtime guard.
                onPress={operable ? onToggle : undefined}
                style={[styles.surface, listening ? styles.surfaceListening : null, operable ? null : styles.disabled]}
            >
                <Text aria-hidden style={styles.glyph}>
                    {STATE_GLYPH[state]}
                </Text>
                <Text style={styles.label}>{messages.voiceControlLabel}</Text>
                {/* NFR-004 — the state is always in WORDS, never in the glyph or the tint alone. */}
                <Text style={styles.state}>{stateLabel[state]}</Text>
            </Pressable>
            {hint !== null && (
                <Text role="status" style={styles.hint}>
                    {hint}
                </Text>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    container: { alignItems: 'flex-start', gap: nativeTokens.spacing[1] },
    surface: {
        // A 48dp floor, above WCAG 2.5.5's 44px minimum — a kitchen-grade target for busy hands.
        minHeight: 48,
        minWidth: 48,
        flexDirection: 'row',
        alignItems: 'center',
        gap: nativeTokens.spacing[2],
        borderRadius: nativeTokens.radius.lg,
        borderWidth: 1,
        // Unselected, the outline IS the affordance — a UI component owing 3:1 under SC 1.4.11.
        borderColor: palette.slate,
        backgroundColor: palette.white,
        paddingVertical: nativeTokens.spacing[2],
        paddingHorizontal: nativeTokens.spacing[4],
    },
    surfaceListening: { borderColor: palette.seafoam, backgroundColor: palette.pearl },
    disabled: { opacity: 0.5 },
    glyph: { fontSize: nativeTokens.fontSize.bodyMd, color: palette.charcoal },
    label: { fontSize: nativeTokens.fontSize.bodyMd, fontWeight: '600', color: palette.charcoal },
    state: { fontSize: nativeTokens.fontSize.bodyMd, color: palette.slate },
    hint: { maxWidth: 280, fontSize: nativeTokens.fontSize.bodySm, color: palette.slate },
});
