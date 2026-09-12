/**
 * @module @commise/features-recipes/rating — the INTERACTIVE rating variant (FR-013, scenarios 6–10), web leaf.
 *
 * The community aggregate plus a 5-option star radiogroup that submits the viewer's own rating (idempotent
 * upsert that replaces on re-rate, Sc7) and a remove affordance (idempotent, Sc10), with in-flight and honest
 * error surfaces.
 *
 * Controlled + presentational: it owns no remote state and fetches nothing. Accessibility is first-class — a
 * real radiogroup of labelled radios (arrow-key operable natively), not clickable divs, and state rides on the
 * radios' checked/disabled semantics + text, never colour. The one hover transition is disabled under
 * `prefers-reduced-motion` (`motion-reduce:transition-none`).
 *
 * The recipe detail projection returns the viewer's OWN prior rating as `RecipeDetail.viewerRating`, which the
 * composing app feeds in as `selectedStars` — so a returning viewer's stars are PRE-SELECTED and the remove
 * affordance is revealed on load. The read-only stars in the aggregate remain the COMMUNITY `average` by
 * design; `selectedStars` is only this input's state. DA4 — the app's `useSetRecipeRating` /
 * `useDeleteRecipeRating` hooks patch `viewerRating` in the query cache optimistically (`onMutate`), so this
 * value never flickers back to the pre-write value before the refetch lands.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { useId, type FC } from 'react';

import { recipeRatingMessages } from './messages.js';
import { RatingSection } from './RatingSection.js';
import { StarShape } from './StarShape.js';
import { STAR_VALUES, formatStarOptionLabel, type RecipeRatingInputProps } from './model.js';

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
    const groupName = useId();
    const starLabels = { one: rating.rateStarOne, other: rating.rateStarOther };

    return (
        <RatingSection average={average} ratingCount={ratingCount}>
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
                        className="w-fit text-body-sm font-medium text-error-dark disabled:opacity-60"
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
                    <p role="alert" className="text-body-sm text-error-dark">
                        {error === 'notAvailable' ? rating.errorNotAvailable : rating.errorGeneric}
                    </p>
                )}
            </div>
        </RatingSection>
    );
};
