/**
 * @module @commise/features-recipes/rating — native rating render components (FR-013).
 *
 * The React Native leaves of the web {@link import('./RecipeRatingControl.js').RecipeRatingInput} /
 * {@link import('./RecipeRatingControl.js').RecipeRatingDisplay} — same contract, split into TWO
 * single-responsibility presentational components (B15) the orchestrating container selects between via
 * {@link ratingModeFor}:
 *  - {@link RecipeRatingDisplay} — READ-ONLY, shown on the viewer's OWN recipe (Sc8): the community aggregate +
 *    a stated reason the input is withheld; the backend guard is the real enforcement.
 *  - {@link RecipeRatingInput} — INTERACTIVE: the community aggregate plus a 5-option star radiogroup that
 *    submits the viewer's own rating (idempotent upsert, replaces on re-rate — Sc7) with a remove affordance
 *    (idempotent — Sc10).
 *
 * Both draw the read-only COMMUNITY aggregate through the shared {@link RatingSection} scaffold. Controlled +
 * presentational: they own no remote state. Accessibility mirrors the web leaves — a real `radiogroup` of
 * `radio`s (each with an accessible name + `aria-checked`), state on checked/disabled + text not colour. No
 * animation, so there is nothing to gate on `prefers-reduced-motion`. Like the web leaves, `selectedStars` is
 * fed from the detail's `viewerRating`, so a returning viewer's stars are pre-selected and remove is revealed
 * on load; the read-only stars shown are the COMMUNITY `average`.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import type { FC, ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { STAR_COUNT, formatAverageRating, formatRatingCount, toStarFills } from '../card/model.js';
import { recipeRatingMessages, type RecipeRatingMessages } from './messages.js';
import {
    STAR_VALUES,
    formatStarOptionLabel,
    type RecipeRatingDisplayProps,
    type RecipeRatingInputProps,
} from './model.js';

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

/**
 * The shared rating-section scaffold: the labelled region + community heading + read-only aggregate that BOTH
 * variants render, with each variant's distinct tail supplied as `children`. Keeps the section chrome in one
 * place (§3 DRY) so the display and input variants cannot drift on the heading, region label, or aggregate.
 */
const RatingSection: FC<{ average?: number; ratingCount: number; children: ReactNode }> = ({
    average,
    ratingCount,
    children,
}) => {
    const { rating } = useMessages(recipeRatingMessages);

    return (
        <View accessibilityLabel={rating.regionLabel} style={styles.container}>
            <Text accessibilityRole="header" style={styles.heading}>
                {rating.communityHeading}
            </Text>
            <CommunityAggregate average={average} ratingCount={ratingCount} rating={rating} />
            {children}
        </View>
    );
};

/**
 * The READ-ONLY rating variant shown on the viewer's OWN recipe (Sc8): the community aggregate plus a stated
 * reason the input is withheld. Renders NOTHING interactive — the own-recipe gate is structural here, and the
 * container never mounts this on a rateable recipe (see {@link ratingModeFor}).
 */
export const RecipeRatingDisplay: FC<RecipeRatingDisplayProps> = ({ average, ratingCount }) => {
    const { rating } = useMessages(recipeRatingMessages);

    return (
        <RatingSection average={average} ratingCount={ratingCount}>
            <Text style={styles.note}>{rating.ownRecipeNote}</Text>
        </RatingSection>
    );
};

/**
 * The INTERACTIVE rating variant (scenarios 6–10): the community aggregate plus a 5-option star radiogroup that
 * submits the viewer's own rating (idempotent upsert, replaces on re-rate — Sc7) and a remove affordance
 * (idempotent — Sc10), with in-flight and honest-error surfaces.
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
        </RatingSection>
    );
};

const styles = StyleSheet.create({
    container: { gap: 12, paddingHorizontal: 16, paddingVertical: 8 },
    heading: { fontSize: 18, fontWeight: '600', color: palette.charcoal },
    stars: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    starFilled: { fontSize: 16, color: palette.warning },
    // An EMPTY pip states the readout's SCALE, so it is `slate`, not `mist` — see the palette JSDoc in
    // `@commise/ui`'s `tokens/colors.ts`. The U4 pass fixed the sibling `RecipeCard.native.tsx` and MISSED
    // this leaf, so both of its empty-pip styles were still the 1.9:1 hairline tone.
    starEmpty: { fontSize: 16, color: palette.slate },
    unrated: { fontSize: 13, color: palette.slate },
    rateBlock: { gap: 10 },
    rateHeading: { fontSize: 14, fontWeight: '500', color: palette.charcoal },
    rateStarFilled: { fontSize: 30, color: palette.warning },
    rateStarEmpty: { fontSize: 30, color: palette.slate },
    // B10 — a ≥44×44 touch target around the 30px glyph (WCAG 2.5.5 / Apple + Android minimums).
    starOption: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
    optionDisabled: { opacity: 0.6 },
    removeLabel: { fontSize: 14, fontWeight: '600', color: palette['error-dark'] },
    status: { fontSize: 13, color: palette.slate },
    error: { fontSize: 13, color: palette['error-dark'] },
    note: { fontSize: 13, color: palette.slate },
});
