/**
 * @module @commise/features-recipes/rating — native interactive rating control (FR-013).
 *
 * The React Native leaf of {@link import('./RecipeRatingControl.js').RecipeRatingControl} — same contract and
 * state machine: a read-only COMMUNITY aggregate (the social-proof score, shown in both modes) plus a 5-option
 * star radiogroup that submits the viewer's own rating (idempotent upsert, replaces on re-rate — Sc7) with a
 * remove affordance (idempotent — Sc10). Withheld on the viewer's own recipe (`mode="own"`, Sc8) behind a
 * stated reason; the backend guard is the real enforcement.
 *
 * Controlled + presentational: owns no remote state. Accessibility mirrors the web leaf — a real `radiogroup`
 * of `radio`s (each with an accessible name + `aria-checked`), state on checked/disabled + text not colour.
 * No animation, so there is nothing to gate on `prefers-reduced-motion`. Like the web leaf, `selectedStars`
 * is fed from the detail's `viewerRating` (the viewer's own prior rating), so a returning viewer's stars are
 * pre-selected and remove is revealed on load; the read-only stars shown are the COMMUNITY `average`.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import type { FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { STAR_COUNT, formatAverageRating, formatRatingCount, toStarFills } from '../card/model.js';
import { recipeRatingMessages, type RecipeRatingMessages } from './messages.js';
import { STAR_VALUES, formatStarOptionLabel, type RecipeRatingControlProps } from './model.js';

/** The read-only community aggregate: a labelled star image when rated, an honest "not yet rated" otherwise. */
const CommunityAggregate: FC<{ average?: number; ratingCount: number; rating: RecipeRatingMessages }> = ({
    average,
    ratingCount,
    rating,
}) => {
    const locale = useLocale();

    if (average === undefined || ratingCount === 0) {
        return <Text style={styles.unrated}>{rating.unrated}</Text>;
    }

    const ratings = formatRatingCount(
        ratingCount,
        { one: rating.ratingCountOne, other: rating.ratingCountOther },
        locale,
    );
    const label = rating.communitySummary
        .replace('{average}', formatAverageRating(average, locale))
        .replace('{ratings}', ratings);
    const fills = toStarFills(average);

    return (
        <View accessible accessibilityRole="image" accessibilityLabel={label} style={styles.stars}>
            {Array.from({ length: STAR_COUNT }, (_value, index) => (
                <Text key={index} style={fills[index] ? styles.starFilled : styles.starEmpty}>
                    ★
                </Text>
            ))}
        </View>
    );
};

export const RecipeRatingControl: FC<RecipeRatingControlProps> = ({
    mode,
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
        <View accessibilityLabel={rating.regionLabel} style={styles.container}>
            <Text accessibilityRole="header" style={styles.heading}>
                {rating.communityHeading}
            </Text>
            <CommunityAggregate average={average} ratingCount={ratingCount} rating={rating} />

            {mode === 'own' ? (
                <Text style={styles.note}>{rating.ownRecipeNote}</Text>
            ) : (
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
                                    style={pending ? styles.optionDisabled : undefined}
                                >
                                    <Text style={filled ? styles.rateStarFilled : styles.rateStarEmpty}>★</Text>
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
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    container: { gap: 12, paddingHorizontal: 16, paddingVertical: 8 },
    heading: { fontSize: 18, fontWeight: '600', color: palette.charcoal },
    stars: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    starFilled: { fontSize: 16, color: palette.warning },
    starEmpty: { fontSize: 16, color: palette.mist },
    unrated: { fontSize: 13, color: palette.slate },
    rateBlock: { gap: 10 },
    rateHeading: { fontSize: 14, fontWeight: '500', color: palette.charcoal },
    rateStarFilled: { fontSize: 30, color: palette.warning },
    rateStarEmpty: { fontSize: 30, color: palette.mist },
    optionDisabled: { opacity: 0.6 },
    removeLabel: { fontSize: 14, fontWeight: '600', color: palette.error },
    status: { fontSize: 13, color: palette.slate },
    error: { fontSize: 13, color: palette.error },
    note: { fontSize: 13, color: palette.slate },
});
