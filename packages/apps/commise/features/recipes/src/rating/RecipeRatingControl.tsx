/**
 * @module @commise/features-recipes/rating — web interactive rating control (FR-013).
 *
 * The recipe-detail affordance that lets a viewer rate a recipe they can see and do NOT own (US "Ratings",
 * scenarios 6–10). Two parts:
 *  - the COMMUNITY aggregate, read-only — the social-proof score every viewer sees (`average` / `ratingCount`,
 *    the mockup's whole-star display), shown in both `rate` and `own` modes;
 *  - the RATE action — a 5-option star radiogroup that submits the viewer's own rating (an idempotent upsert
 *    that replaces on re-rate, Sc7) plus a remove affordance (idempotent, Sc10). Withheld on the viewer's own
 *    recipe (`mode="own"`, Sc8) behind a stated reason; the backend guard is the real enforcement.
 *
 * Controlled + presentational: it owns no remote state and fetches nothing. Accessibility is first-class — the
 * input is a real radiogroup of labelled radios (arrow-key operable natively), not clickable divs, and state
 * rides on the radios' checked/disabled semantics + text, never colour. The one hover transition is disabled
 * under `prefers-reduced-motion` (`motion-reduce:transition-none`).
 *
 * The recipe detail projection returns the viewer's OWN prior rating as `RecipeDetail.viewerRating`, which the
 * composing app feeds in as `selectedStars` — so a returning viewer's stars are PRE-SELECTED and the remove
 * affordance is revealed on load. The read-only stars the viewer SEES remain the COMMUNITY `average` by design
 * (not "your rating"); `selectedStars` is only the rate INPUT's state. See `resolveSelectedStars` for how the
 * app keeps the server value authoritative once loaded.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { useId, type FC } from 'react';

import { STAR_COUNT, formatAverageRating, formatRatingCount, toStarFills } from '../card/model.js';
import { recipeRatingMessages, type RecipeRatingMessages } from './messages.js';
import { STAR_VALUES, formatStarOptionLabel, type RecipeRatingControlProps } from './model.js';

const STAR_PATH =
    'M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z';

const StarShape: FC<{ filled: boolean; size?: string }> = ({ filled, size = 'h-5 w-5' }) => (
    <svg
        aria-hidden="true"
        className={`${size} ${filled ? 'fill-warning text-warning' : 'text-mist'}`}
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        viewBox="0 0 20 20"
    >
        <path d={STAR_PATH} />
    </svg>
);

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
    const groupName = useId();
    const starLabels = { one: rating.rateStarOne, other: rating.rateStarOther };

    return (
        <section aria-label={rating.regionLabel} className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4">
            <div className="flex flex-col gap-2">
                <h2 className="font-display text-heading-md font-semibold text-charcoal">{rating.communityHeading}</h2>
                <CommunityAggregate average={average} ratingCount={ratingCount} rating={rating} />
            </div>

            {mode === 'own' ? (
                <p className="text-body-sm text-slate">{rating.ownRecipeNote}</p>
            ) : (
                <div className="flex flex-col gap-3">
                    <fieldset role="radiogroup" aria-label={rating.groupLabel} className="flex flex-col gap-2">
                        <legend className="text-body-sm font-medium text-charcoal">{rating.rateHeading}</legend>
                        <div className="flex items-center gap-1">
                            {STAR_VALUES.map((value) => {
                                const optionLabel = formatStarOptionLabel(value, starLabels, locale);
                                const filled = selectedStars !== undefined && value <= selectedStars;

                                return (
                                    <label
                                        key={value}
                                        aria-label={optionLabel}
                                        className={`relative rounded p-0.5 transition motion-reduce:transition-none ${
                                            pending ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:scale-110'
                                        }`}
                                    >
                                        {/* Transparent overlay covering the star, so the radio itself is the
                                            click/tap target (directly actionable for pointer users + E2E),
                                            with the star rendered beneath — not a 1px `sr-only` point the
                                            star would overlay and pointer drivers could not reach. */}
                                        <input
                                            type="radio"
                                            name={groupName}
                                            className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
                                            aria-label={optionLabel}
                                            checked={selectedStars === value}
                                            disabled={pending}
                                            onChange={() => onRate(value)}
                                        />
                                        <StarShape filled={filled} size="h-7 w-7" />
                                    </label>
                                );
                            })}
                        </div>
                    </fieldset>

                    {selectedStars !== undefined && (
                        <button
                            type="button"
                            disabled={pending}
                            onClick={onRemove}
                            className="w-fit text-body-sm font-medium text-error disabled:opacity-60"
                        >
                            {rating.removeLabel}
                        </button>
                    )}

                    {pending && (
                        <span role="status" aria-label={rating.submittingLabel} className="text-body-sm text-slate">
                            {rating.submittingLabel}
                        </span>
                    )}

                    {error !== undefined && (
                        <p role="alert" className="text-body-sm text-error">
                            {error === 'notAvailable' ? rating.errorNotAvailable : rating.errorGeneric}
                        </p>
                    )}
                </div>
            )}
        </section>
    );
};
