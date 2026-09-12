/**
 * @module @commise/features-recipes — NATIVE serving-count control.
 *
 * The React Native leaf of `ServingScaleControl`: same contract, same range, same clamping — a `props → JSX`
 * render whose one piece of state, `hasStepped`, only gates when the count starts being spoken.
 *
 * PLATFORM FORK, recorded: the web leaf offers a number INPUT between the two step buttons; this one offers
 * a read-only count. Free-text numeric entry on a phone means an on-screen keyboard covering the recipe and
 * a transient empty field, for a value that moves one serving at a time in practice. Both platforms expose
 * the same capability (reach any serving count in the domain's range) — only the affordance differs, which
 * §14 permits; a web-only FEATURE would not be.
 *
 * Accessibility: after a step, a visually hidden `LiveRegion` speaks `servingsAnnouncement` ("5 servings", "12
 * servings, maximum") — the same sentence the web leaf's status region speaks. The buttons and the count stay
 * SEPARATE accessible elements on purpose: one `adjustable` row would hide "More servings" from iOS Voice Control
 * and from Maestro (staff-ux-engineer). The buttons keep native `disabled` at the limits; unlike web, a disabled
 * native control does not strand the screen-reader cursor.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import { LiveRegion } from '@commise/ui/live-region';
import { nativeTokens } from '@commise/ui/native';
import { clampServings, servingsRange } from '@kitchensink/recipe-core/scaling';
import { useState, type FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { recipeMessages } from '../messages.js';
import { servingsAnnouncement, type ServingScaleControlProps } from './model.js';

export const ServingScaleControl: FC<ServingScaleControlProps> = ({ servings, baseServings, onServingsChange }) => {
    const { detail } = useMessages(recipeMessages);
    const locale = useLocale();
    const { min, max } = servingsRange(baseServings);
    // Whether the cook has stepped yet: the spoken count stays empty until then, because the iOS announcement fires
    // on mount for non-empty text and every recipe would otherwise open by reading out its serving count.
    const [hasStepped, setHasStepped] = useState(false);

    const change = (next: number): void => {
        setHasStepped(true);
        onServingsChange?.(clampServings(next, baseServings));
    };

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
            {/* What a step SAYS — ALWAYS MOUNTED, because Android speaks a change to a region it already holds. */}
            <LiveRegion politeness="polite" visuallyHidden>
                {hasStepped ? servingsAnnouncement(servings, baseServings, detail, locale) : ''}
            </LiveRegion>
        </View>
    );
};

/** The minus and plus targets, at RC-3's 44pt floor. */
const STEP_TARGET_DP = 44;

/** The value box between them. Wide enough for a three-digit count without reflowing the row. */
const VALUE_WIDTH_DP = 40;

/**
 * The width this control cannot render inside without clipping: two touch targets, the value, and the two
 * gaps between them.
 *
 * ⛔ PUBLISHED because the parent must RESERVE it. `RecipeDetailBody`'s four-up stats strip gives each cell
 * an equal `flex: 1` share — ~85dp on a 375dp phone — and this control needs 136, so it overflowed ~25dp
 * off each side and the CI emulator rendered the `−` sliced in half by the screen edge. Deriving the figure
 * here rather than writing `136` over there means raising the touch floor moves the reservation with it.
 */
export const SERVING_STEPPER_MIN_WIDTH = 2 * STEP_TARGET_DP + VALUE_WIDTH_DP + 2 * nativeTokens.spacing[1];

const styles = StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: nativeTokens.spacing[1] },
    // 44pt touch floor (RC-3) on both step controls.
    step: {
        minWidth: STEP_TARGET_DP,
        minHeight: STEP_TARGET_DP,
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
        minWidth: VALUE_WIDTH_DP,
        textAlign: 'center',
        fontSize: nativeTokens.fontSize.bodyLg,
        fontWeight: '700',
        color: palette.charcoal,
    },
});
