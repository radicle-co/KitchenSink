/**
 * @module @commise/features-recipes/rating — the shared rating-section scaffold, web leaf.
 *
 * The labelled region + community heading + read-only aggregate that BOTH rating variants
 * (`RecipeRatingDisplay`, `RecipeRatingInput`) render, with each variant's distinct tail supplied as
 * `children`. Keeps the section chrome in one place (§3 DRY) so the display and input variants cannot drift on
 * the heading, region label, or aggregate.
 *
 * The COMMUNITY aggregate — the social-proof score every viewer sees (`average` / `ratingCount`) — is private
 * to this module: it has exactly one consumer, and it is the aggregate's placement inside the scaffold that
 * the two variants must not be able to disagree about.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import type { FC, ReactNode } from 'react';

import { STAR_COUNT, formatAverageRating, formatRatingCount, toStarFills } from '../card/model.js';
import { recipeRatingMessages, type RecipeRatingMessages } from './messages.js';
import { StarShape } from './StarShape.js';

/** The read-only community aggregate: a labelled star image when rated, an honest "not yet rated" otherwise. */
const CommunityAggregate: FC<{ average?: number; ratingCount: number; rating: RecipeRatingMessages }> = ({
    average,
    ratingCount,
    rating,
}) => {
    const locale = useLocale();

    if (average === undefined || ratingCount === 0) {
        return <p className="text-body-sm text-slate">{rating.unrated}</p>;
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
        <div role="img" aria-label={label} className="flex items-center gap-1">
            {Array.from({ length: STAR_COUNT }, (_value, index) => (
                <StarShape key={index} filled={fills[index] ?? false} />
            ))}
            <span aria-hidden className="ml-1 text-body-sm text-slate">
                {formatAverageRating(average, locale)} · {ratings}
            </span>
        </div>
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
        <section aria-label={rating.regionLabel} className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4">
            <div className="flex flex-col gap-2">
                <h2 className="font-display text-heading-md font-semibold text-charcoal">{rating.communityHeading}</h2>
                <CommunityAggregate average={average} ratingCount={ratingCount} rating={rating} />
            </div>
            {children}
        </section>
    );
};
