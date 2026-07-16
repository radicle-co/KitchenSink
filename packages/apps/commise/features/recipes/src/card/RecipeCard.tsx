/**
 * @module @commise/features-recipes/card — web mockup-parity recipe card.
 *
 * The single card used by BOTH the Home "Recent recipes" widget and the recipe list (the mockup draws them
 * identically): a 4:3 cover with a top-corner PRO badge, the title, a time · servings · difficulty meta row,
 * and a 5-star rating. Presentational — it holds no state and fetches nothing. When `onSelect` is given the
 * card is an actionable button (the list); without it, a non-interactive article (the widget).
 *
 * Design rules encoded here (do not "simplify" them away):
 * - ABSENT difficulty renders NO pill — never a default (FR-001b).
 * - The PRO badge is driven by the materialized `usesPremiumCapability` flag — never re-derived (FR-003a).
 * - The stars are DISPLAY-ONLY here: these are the viewer's own recent/owned recipes, which they cannot rate
 *   (a 403); an unrated recipe shows an honest "not yet rated" state, never a fabricated 0-star score. The
 *   interactive rating control lives on the detail view of a recipe the viewer does NOT own.
 * - The cover is the FULL-SIZE original (up to 5 MB) painted into a small tile (FOLLOW-UP-CR-001-A).
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { RecipeDifficulty } from '@kitchensink/recipe-core';

import { recipeMessages, type RecipeCardMessages } from '../messages.js';
import { formatDurationMinutes } from '../list/model.js';
import {
    STAR_COUNT,
    difficultyTone,
    formatAverageRating,
    formatRatingCount,
    toStarFills,
    type DifficultyTone,
    type RecipeCardModel,
} from './model.js';

/** Props for the shared recipe card. */
export interface RecipeCardProps {
    readonly recipe: RecipeCardModel;
    /** When provided, the card is an actionable button that reports the recipe id (the list card). */
    readonly onSelect?: (id: string) => void;
}

/** Difficulty pill tone → Tailwind classes (warning is a light tone, so it needs dark text for contrast). */
const TONE_CLASS: Record<DifficultyTone, string> = {
    success: 'bg-success text-white',
    warning: 'bg-warning text-charcoal',
    error: 'bg-error text-white',
};

const ClockIcon: FC = () => (
    <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
        />
    </svg>
);

const PeopleIcon: FC = () => (
    <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
        />
    </svg>
);

const STAR_PATH =
    'M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z';

const Star: FC<{ filled: boolean }> = ({ filled }) => (
    <svg
        aria-hidden="true"
        className={`h-4 w-4 ${filled ? 'fill-warning text-warning' : 'text-mist'}`}
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        viewBox="0 0 20 20"
    >
        <path d={STAR_PATH} />
    </svg>
);

/** The star rating row: display-only. Rated → a labelled star group; unrated → an honest "not yet rated". */
const RatingRow: FC<{ recipe: RecipeCardModel; card: RecipeCardMessages }> = ({ recipe, card }) => {
    const locale = useLocale();

    if (recipe.averageRating === undefined || recipe.ratingCount === 0) {
        return <span className="text-body-sm text-slate">{card.unrated}</span>;
    }

    const ratings = formatRatingCount(
        recipe.ratingCount,
        { one: card.ratingCountOne, other: card.ratingCountOther },
        locale,
    );
    const label = card.ratingSummary
        .replace('{average}', formatAverageRating(recipe.averageRating, locale))
        .replace('{ratings}', ratings);
    const fills = toStarFills(recipe.averageRating);

    return (
        <div role="img" aria-label={label} className="flex items-center gap-1">
            {Array.from({ length: STAR_COUNT }, (_value, index) => (
                <Star key={index} filled={fills[index] ?? false} />
            ))}
        </div>
    );
};

/** The card's inner content — identical whether the card is a button (list) or an article (widget). */
const CardBody: FC<{ recipe: RecipeCardModel; card: RecipeCardMessages }> = ({ recipe, card }) => {
    const { list } = useMessages(recipeMessages);
    const duration = formatDurationMinutes(recipe.totalTimeMinutes, list.durationMinutes);
    const difficultyLabel: Record<RecipeDifficulty, string> = {
        [RecipeDifficulty.EASY]: card.difficultyEasy,
        [RecipeDifficulty.MEDIUM]: card.difficultyMedium,
        [RecipeDifficulty.HARD]: card.difficultyHard,
    };

    return (
        <>
            <div className="relative aspect-[4/3] w-full overflow-hidden rounded-t-2xl bg-pearl">
                {recipe.coverPhotoUrl !== undefined ? (
                    // FOLLOW-UP-CR-001-A: full-size original into a thumbnail-sized tile (no derived variants).
                    <img src={recipe.coverPhotoUrl} alt={recipe.title} className="h-full w-full object-cover" />
                ) : (
                    <div
                        role="img"
                        aria-label={card.noPhotoLabel}
                        className="flex h-full w-full items-center justify-center text-mist"
                    >
                        <svg
                            aria-hidden="true"
                            className="h-10 w-10"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={1.5}
                                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                            />
                        </svg>
                    </div>
                )}
                {recipe.usesPremiumCapability && (
                    <span
                        aria-label={card.proBadgeLabel}
                        className="absolute right-2 top-2 rounded-full bg-premium px-2 py-1 text-caption font-semibold text-white"
                    >
                        {card.proBadge}
                    </span>
                )}
            </div>
            <div className="flex flex-col gap-2 p-4">
                <h3 className="font-display text-heading-md font-semibold text-charcoal line-clamp-2">
                    {recipe.title}
                </h3>
                <div className="flex items-center gap-3 text-body-sm text-slate">
                    <span
                        aria-label={card.timeLabel.replace('{minutes}', String(recipe.totalTimeMinutes))}
                        className="flex items-center gap-1"
                    >
                        <ClockIcon />
                        {duration}
                    </span>
                    <span
                        aria-label={card.servingsLabel.replace('{count}', String(recipe.servings))}
                        className="flex items-center gap-1"
                    >
                        <PeopleIcon />
                        {recipe.servings}
                    </span>
                    {recipe.difficulty !== undefined && (
                        <span
                            className={`rounded-full px-2 py-0.5 text-caption font-semibold ${TONE_CLASS[difficultyTone(recipe.difficulty)]}`}
                        >
                            {difficultyLabel[recipe.difficulty]}
                        </span>
                    )}
                </div>
                <RatingRow recipe={recipe} card={card} />
            </div>
        </>
    );
};

const CARD_SHELL =
    'block overflow-hidden rounded-2xl bg-card text-left shadow-sm ring-1 ring-border transition hover:-translate-y-0.5 hover:shadow-md';

/**
 * The shared recipe card. `onSelect` present → an actionable button (list); absent → a non-interactive
 * article (the Home widget). Either way the outer element is named by the recipe title.
 */
export const RecipeCard: FC<RecipeCardProps> = ({ recipe, onSelect }) => {
    const { card } = useMessages(recipeMessages);

    if (onSelect === undefined) {
        return (
            <article aria-label={recipe.title} className={CARD_SHELL}>
                <CardBody recipe={recipe} card={card} />
            </article>
        );
    }

    return (
        <article aria-label={recipe.title}>
            <button
                type="button"
                aria-label={recipe.title}
                onClick={() => onSelect(recipe.id)}
                className={`${CARD_SHELL} w-full`}
            >
                <CardBody recipe={recipe} card={card} />
            </button>
        </article>
    );
};
