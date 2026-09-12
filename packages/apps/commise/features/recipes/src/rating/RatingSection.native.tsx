/**
 * @module @commise/features-recipes/rating — the shared rating-section scaffold, native leaf.
 *
 * The React Native peer of the web `RatingSection`: the labelled region + community heading + read-only
 * aggregate that BOTH rating variants render, with each variant's distinct tail supplied as `children`. Keeps
 * the section chrome in one place (§3 DRY) so the display and input variants cannot drift on the heading,
 * region label, or aggregate.
 *
 * As on web, the COMMUNITY aggregate is private to this module — it has exactly one consumer, and its
 * placement inside the scaffold is precisely what the two variants must not be able to disagree about.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import type { FC, ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { STAR_COUNT, formatAverageRating, formatRatingCount, toStarFills } from '../card/model.js';
import { recipeRatingMessages, type RecipeRatingMessages } from './messages.js';
import { StarShape } from './StarShape.native.js';

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
                <StarShape key={index} filled={fills[index] ?? false} />
            ))}
        </View>
    );
};

/** Props for {@link RatingSection}. */
export interface RatingSectionProps {
    /** The community average, or `undefined` when unrated. */
    readonly average?: number;
    /** How many ratings the community average is drawn from. */
    readonly ratingCount: number;
    /** The variant's own tail, rendered below the aggregate. */
    readonly children: ReactNode;
}

/**
 * The rating section chrome.
 *
 * @param props - The community aggregate values and the variant's tail.
 * @returns The labelled rating region.
 */
export const RatingSection: FC<RatingSectionProps> = ({ average, ratingCount, children }) => {
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

const styles = StyleSheet.create({
    container: { gap: 12, paddingHorizontal: 16, paddingVertical: 8 },
    heading: { fontSize: 18, fontWeight: '600', color: palette.charcoal },
    stars: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    unrated: { fontSize: 13, color: palette.slate },
});
