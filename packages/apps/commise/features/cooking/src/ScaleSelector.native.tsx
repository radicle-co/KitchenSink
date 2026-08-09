/**
 * @module @commise/features-cooking/ScaleSelector — the NATIVE yield-scale control (FR-034a).
 *
 * The React Native leaf of the web {@link import('./ScaleSelector').ScaleSelector} — same contract (shared
 * props in `./sessionExtras`), same pattern: a **pure presentational (render) component** in its
 * CONTROLLED form. `props → JSX`, one responsibility, no fetching, no mutation, no state, no ref. The
 * option set IS the domain's bounded `ALLOWED_SCALE_FACTORS`, and the advisory's visibility is
 * `shouldShowNotScaledAdvisory` — neither rule is re-derived here.
 *
 * SAFETY INVARIANT (spec.md D-002): scaling changes DISPLAYED ingredient quantities only. Cook time does
 * not scale linearly with yield, so this control touches no countdown — structurally, it neither imports
 * nor receives anything countdown-shaped (asserted on this file's own import graph).
 *
 * Accessibility mirrors the web leaf: a labelled `radiogroup` of named `radio`s carrying BOTH
 * `accessibilityState.checked` (the device trait) and `aria-checked` (the DOM projection under
 * react-native-web), a ≥44×44 touch target per option (WCAG 2.5.5), and the advisory as an `alert` so it
 * is announced when it appears — state never rides on colour.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import { ALLOWED_SCALE_FACTORS, shouldShowNotScaledAdvisory } from '@kitchensink/cooking-core';
import type { FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { cookingMessages } from './messages';
import type { ScaleSelectorProps } from './sessionExtras';

/** The yield-scale control shown inside Cooking Mode (FR-034a): quantities scale, cook times do not. */
export const ScaleSelector: FC<ScaleSelectorProps> = ({ scaleFactor, onScaleChange }) => {
    const cooking = useMessages(cookingMessages);
    const locale = useLocale();
    const formatFactor = new Intl.NumberFormat(locale);

    return (
        <View style={styles.container}>
            <Text style={styles.heading}>{cooking.scaleLabel}</Text>
            <View accessibilityRole="radiogroup" accessibilityLabel={cooking.scaleLabel} style={styles.options}>
                {ALLOWED_SCALE_FACTORS.map((factor) => {
                    const optionLabel = cooking.scaleOption.replace('{factor}', formatFactor.format(factor));
                    const active = factor === scaleFactor;

                    return (
                        <Pressable
                            key={factor}
                            accessibilityRole="radio"
                            accessibilityState={{ checked: active }}
                            aria-checked={active}
                            accessibilityLabel={optionLabel}
                            onPress={() => onScaleChange(factor)}
                            style={[styles.option, active ? styles.optionActive : null]}
                        >
                            <Text style={active ? styles.optionLabelActive : styles.optionLabel}>{optionLabel}</Text>
                        </Pressable>
                    );
                })}
            </View>

            {shouldShowNotScaledAdvisory(scaleFactor) && (
                <Text accessibilityRole="alert" style={styles.advisory}>
                    {cooking.scaleNotAppliedToTimes}
                </Text>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    container: { gap: 8 },
    heading: { fontSize: 14, fontWeight: '500', color: palette.charcoal },
    options: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    // A ≥44×44 touch target (WCAG 2.5.5 / Apple + Android minimums).
    option: {
        minWidth: 44,
        minHeight: 44,
        paddingHorizontal: 12,
        borderRadius: 22,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
        // Unselected, the outline IS the affordance — a UI component owing 3:1 under SC 1.4.11, where `mist`
        // measures 1.90:1.
        borderColor: palette.slate,
    },
    optionActive: { borderColor: palette.seafoam, backgroundColor: palette.seafoam },
    optionLabel: { fontSize: 15, fontWeight: '500', color: palette.charcoal },
    optionLabelActive: { fontSize: 15, fontWeight: '500', color: palette.white },
    advisory: { fontSize: 13, color: palette.charcoal },
});
