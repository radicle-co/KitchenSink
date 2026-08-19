/**
 * @module @commise/features-recipes — NATIVE serving-count control.
 *
 * The React Native leaf of `ServingScaleControl`: same contract, same range, same clamping — a pure
 * `props → JSX` render with no state of its own.
 *
 * PLATFORM FORK, recorded: the web leaf offers a number INPUT between the two step buttons; this one offers
 * a read-only count. Free-text numeric entry on a phone means an on-screen keyboard covering the recipe and
 * a transient empty field, for a value that moves one serving at a time in practice. Both platforms expose
 * the same capability (reach any serving count in the domain's range) — only the affordance differs, which
 * §14 permits; a web-only FEATURE would not be.
 */
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import { nativeTokens } from '@commise/ui/native';
import { clampServings, servingsRange } from '@kitchensink/recipe-core/scaling';
import type { FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { recipeMessages } from '../messages.js';
import type { ServingScaleControlProps } from './model.js';

export const ServingScaleControl: FC<ServingScaleControlProps> = ({ servings, baseServings, onServingsChange }) => {
    const { detail } = useMessages(recipeMessages);
    const { min, max } = servingsRange(baseServings);
    const change = (next: number): void => onServingsChange?.(clampServings(next, baseServings));

    return (
        <View style={styles.row}>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={detail.servingsDecrease}
                // Both forms are load-bearing: `accessibilityState` is the trait VoiceOver/TalkBack read,
                // `disabled` is what react-native-web projects into the DOM (and what actually blocks the
                // press). The same pairing the detail's checkboxes document.
                accessibilityState={{ disabled: servings <= min }}
                disabled={servings <= min}
                onPress={() => change(servings - 1)}
                style={({ pressed }) => [
                    styles.step,
                    servings <= min && styles.stepDisabled,
                    pressed && styles.pressed,
                ]}
            >
                <Text style={styles.stepLabel}>−</Text>
            </Pressable>
            <Text style={styles.value}>{String(servings)}</Text>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={detail.servingsIncrease}
                accessibilityState={{ disabled: servings >= max }}
                disabled={servings >= max}
                onPress={() => change(servings + 1)}
                style={({ pressed }) => [
                    styles.step,
                    servings >= max && styles.stepDisabled,
                    pressed && styles.pressed,
                ]}
            >
                <Text style={styles.stepLabel}>+</Text>
            </Pressable>
        </View>
    );
};

const styles = StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: nativeTokens.spacing[1] },
    // 44pt touch floor (RC-3) on both step controls.
    step: {
        minWidth: 44,
        minHeight: 44,
        borderRadius: nativeTokens.radius.full,
        borderWidth: 1,
        // Contrast: a control boundary owes 3:1 under SC 1.4.11 — slate clears it, the mist hairline did not.
        borderColor: palette.slate,
        alignItems: 'center',
        justifyContent: 'center',
    },
    // Unavailable reads as unavailable, rather than as a live control that silently does nothing.
    stepDisabled: { opacity: 0.4 },
    pressed: { backgroundColor: palette.pearl },
    stepLabel: { fontSize: nativeTokens.fontSize.bodyLg, fontWeight: '600', color: palette.charcoal },
    value: {
        minWidth: 40,
        textAlign: 'center',
        fontSize: nativeTokens.fontSize.bodyLg,
        fontWeight: '700',
        color: palette.charcoal,
    },
});
