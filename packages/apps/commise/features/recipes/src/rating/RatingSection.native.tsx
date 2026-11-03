/**
 * @module @commise/features-recipes/rating — the rating card's scaffold, native leaf.
 *
 * The React Native peer of the web `RatingSection`: the labelled card that BOTH rating variants render, with each
 * variant's tail supplied as `children`. It draws the community summary on one row, stars then the figure then the
 * count (`RecipeDetailAndroid384`), and no heading of its own.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { Text } from '@commise/ui/text';
import type { FC, ReactNode } from 'react';
import { styled, XStack, YStack } from 'tamagui';

import { STAR_COUNT, formatAverageRating, formatRatingCount, toStarFills } from '../card/model.js';
import { recipeRatingMessages, type RecipeRatingMessages } from './messages.js';
import { StarShape } from './StarShape.native.js';

const Card = styled(YStack, {
    name: 'RatingCard',
    gap: '$3',
    padding: '$4',
    borderRadius: '$lg',
    borderWidth: 1,
    borderColor: '$lineDivider',
    backgroundColor: '$paper',
});

const SummaryRow = styled(XStack, { name: 'RatingSummaryRow', alignItems: 'center', gap: '$2', flexWrap: 'wrap' });

/** The read-only community summary: stars, the figure and the count when rated, an honest "not yet rated" otherwise. */
const CommunityAggregate: FC<{ average?: number; ratingCount: number; rating: RecipeRatingMessages }> = ({
    average,
    ratingCount,
    rating,
}) => {
    const locale = useLocale();

    if (average === undefined || ratingCount === 0) {
        return (
            <Text typeRole="meta" color="$inkMuted">
                {rating.unrated}
            </Text>
        );
    }

    const ratings = formatRatingCount(
        ratingCount,
        { one: rating.ratingCountOne, other: rating.ratingCountOther },
        locale,
    );
    const figure = formatAverageRating(average, locale);
    const label = rating.communitySummary.replace('{average}', figure).replace('{ratings}', ratings);
    const fills = toStarFills(average);

    return (
        <SummaryRow>
            <XStack accessible role="img" aria-label={label} gap="$1">
                {Array.from({ length: STAR_COUNT }, (_value, index) => (
                    <StarShape key={index} filled={fills[index] ?? false} />
                ))}
            </XStack>
            <Text typeRole="body" figures>
                {figure}
            </Text>
            <Text typeRole="body" color="$inkMuted">
                {ratings}
            </Text>
        </SummaryRow>
    );
};

/** Props for {@link RatingSection}. */
export interface RatingSectionProps {
    /** The community average, or `undefined` when unrated. */
    readonly average?: number;
    /** How many ratings the community average is drawn from. */
    readonly ratingCount: number;
    /** The variant's own tail, rendered below the summary. */
    readonly children: ReactNode;
}

/**
 * The rating card.
 *
 * @param props - The community summary values and the variant's tail.
 * @returns The labelled rating card.
 */
export const RatingSection: FC<RatingSectionProps> = ({ average, ratingCount, children }) => {
    const { rating } = useMessages(recipeRatingMessages);

    return (
        <Card collapsable={false} aria-label={rating.regionLabel}>
            <CommunityAggregate average={average} ratingCount={ratingCount} rating={rating} />
            {children}
        </Card>
    );
};
