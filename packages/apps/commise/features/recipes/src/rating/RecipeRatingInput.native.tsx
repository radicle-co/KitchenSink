/**
 * @module @commise/features-recipes/rating — the INTERACTIVE rating variant (FR-013, scenarios 6–10), native
 * leaf.
 *
 * The React Native peer of the web `RecipeRatingInput` — same contract: the community aggregate plus a
 * 5-option star radiogroup that submits the viewer's own rating (idempotent upsert, replaces on re-rate —
 * Sc7) with a remove affordance (idempotent — Sc10).
 *
 * Controlled + presentational: it owns no remote state. Accessibility mirrors the web leaf — a real
 * `radiogroup` of `radio`s (each with an accessible name + `aria-checked`), state on checked/disabled + text
 * not colour. No animation, so there is nothing to gate on `prefers-reduced-motion`. Like the web leaf,
 * `selectedStars` is fed from the detail's `viewerRating`, so a returning viewer's stars are pre-selected and
 * remove is revealed on load; the stars in the aggregate remain the COMMUNITY `average`.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import type { FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { recipeRatingMessages } from './messages.js';
import { RatingSection } from './RatingSection.native.js';
import { StarShape } from './StarShape.native.js';
import { STAR_VALUES, formatStarOptionLabel, type RecipeRatingInputProps } from './model.js';

/** Font size of the rate-input stars — deliberately larger than the readout pips (they are a touch target). */
const RATE_STAR_SIZE = 30;

/**
 * The interactive rating variant.
 *
 * @param props - The community aggregate, the viewer's own selection, and the rate/remove callbacks.
 * @returns The rating section with the star radiogroup.
 */
export const RecipeRatingInput: FC<RecipeRatingInputProps> = ({
    average,
    ratingCount,
    selectedStars,
    pending = false,
    error,
    onRate,
    onRemove,
}) => {
    const { rating } = useMessages(recipeRatingMessages);
    const locale = useLocale();
    const starLabels = { one: rating.rateStarOne, other: rating.rateStarOther };

    return (
        <RatingSection average={average} ratingCount={ratingCount}>
            <View style={styles.rateBlock}>
                <Text style={styles.rateHeading}>{rating.rateHeading}</Text>
                <View accessibilityRole="radiogroup" accessibilityLabel={rating.groupLabel} style={styles.stars}>
                    {STAR_VALUES.map((value) => {
                        const optionLabel = formatStarOptionLabel(value, starLabels, locale);
                        const filled = selectedStars !== undefined && value <= selectedStars;

                        return (
                            <Pressable
                                key={value}
                                accessibilityRole="radio"
                                accessibilityLabel={optionLabel}
                                aria-checked={selectedStars === value}
                                disabled={pending}
                                onPress={() => onRate(value)}
                                style={[styles.starOption, pending ? styles.optionDisabled : null]}
                            >
                                <StarShape filled={filled} size={RATE_STAR_SIZE} />
                            </Pressable>
                        );
                    })}
                </View>

                {selectedStars !== undefined && (
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={rating.removeLabel}
                        disabled={pending}
                        onPress={onRemove}
                        style={pending ? styles.optionDisabled : undefined}
                    >
                        <Text style={styles.removeLabel}>{rating.removeLabel}</Text>
                    </Pressable>
                )}

                {pending && <Text style={styles.status}>{rating.submittingLabel}</Text>}

                {error !== undefined && (
                    <Text accessibilityRole="alert" style={styles.error}>
                        {error === 'notAvailable' ? rating.errorNotAvailable : rating.errorGeneric}
                    </Text>
                )}
            </View>
        </RatingSection>
    );
};

const styles = StyleSheet.create({
    stars: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    rateBlock: { gap: 10 },
    rateHeading: { fontSize: 14, fontWeight: '500', color: palette.charcoal },
    // B10 — a ≥44×44 touch target around the 30px glyph (WCAG 2.5.5 / Apple + Android minimums).
    starOption: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
    optionDisabled: { opacity: 0.6 },
    removeLabel: { fontSize: 14, fontWeight: '600', color: palette['error-dark'] },
    status: { fontSize: 13, color: palette.slate },
    error: { fontSize: 13, color: palette['error-dark'] },
});
