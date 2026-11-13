/**
 * @module @commise/features-recipes/card — what every part of the recipe card draws, derived once from the card's model
 * and copy, shared by the web and native `RecipeCard` leaves (W9-f P7).
 *
 * The card's design rules are decided here, so the two leaves cannot drift on them: an ABSENT difficulty offers no pill,
 * never a default (FR-001b); the PRO badge follows the materialized `usesPremiumCapability` flag (FR-003a); a draft's badge REPLACES the visibility badge, because a free-tier draft is
 * `visibility='public'` while nobody else can see it; the timestamp says "Created" until the recipe is first revised,
 * then "Edited" (CR-002); and an unrated recipe says so, never a 0-star score.
 *
 * What the variants draw (`docs/design/uiRefreshWorkshop5/nativeBoards/designAnswers.md`, 2026-11-02): the cover's status
 * chip (a draft or a private recipe only — a published public recipe is the quiet case), the meta line (the time in hours
 * and minutes, the difficulty as a plain word, the short "4.8 (12)" rating figure), and the timestamp. No card shows
 * servings, cuisine, the tags, the version, a cover time chip or a difficulty badge.
 *
 * Pure: the caller reads the clock and passes `now`.
 *
 * @pattern Presentation Model — the card's view, derived from its model and its copy
 */
import { type Locale, fillTemplate } from '@commise/i18n';
import { RecipeDifficulty, RecipeStatus, RecipeVisibility } from '@kitchensink/recipe-core';

import { formatDuration } from '../format/duration.js';
import type { RecipeMessages } from '../messages.js';
import { formatAverageRating, formatRatingCount, formatRelativeTime, type RecipeCardModel } from './model.js';

/** A recipe's publication status, as the design-system badge names it. */
export type RecipeCardStatus = 'draft' | 'private' | 'public';

/** What every part of the card draws. */
export interface RecipeCardView {
    readonly recipe: RecipeCardModel;
    readonly cover: {
        readonly noPhotoLabel: string;
        /** The PRO badge, for a recipe that uses a premium capability only. */
        readonly pro: { readonly text: string; readonly label: string } | undefined;
        /** The status chip: a draft or a private recipe only. */
        readonly status: { readonly status: Exclude<RecipeCardStatus, 'public'>; readonly text: string } | undefined;
    };
    readonly meta: {
        readonly duration?: string;
        readonly timeLabel: string;
        /** The stated difficulty as a plain word, absent when the author stated none. */
        readonly difficulty: string | undefined;
    };
    readonly badges: {
        /** Draft, or the visibility: never both, because a free-tier draft is `public` while nobody else sees it. */
        readonly status: { readonly status: RecipeCardStatus; readonly text: string };
        readonly timestamp: string;
    };
    readonly rating:
        | { readonly kind: 'unrated'; readonly text: string }
        | {
              readonly kind: 'rated';
              readonly label: string;
              /** The figure beside the stars, e.g. "4.8 (12)". */
              readonly short: string;
          };
}

/**
 * The status a recipe's badge states: Draft replaces the visibility. Pure.
 *
 * @param recipe - The card's model.
 * @returns The status.
 */
function statusOf(recipe: RecipeCardModel): RecipeCardStatus {
    if (recipe.status === RecipeStatus.DRAFT) {
        return 'draft';
    }

    return recipe.visibility === RecipeVisibility.PUBLIC ? 'public' : 'private';
}

/**
 * The card's view. Pure.
 *
 * @param recipe - The card's model.
 * @param copy - The recipe copy: the card's own, the list's and the duration templates.
 * @param locale - The active locale.
 * @param now - The current instant, in ISO 8601, read by the caller.
 * @returns What every part draws.
 */
export function recipeCardViewOf(
    recipe: RecipeCardModel,
    copy: Pick<RecipeMessages, 'card' | 'list' | 'duration'>,
    locale: Locale,
    now: string,
): RecipeCardView {
    const { card } = copy;
    const difficultyLabel: Record<RecipeDifficulty, string> = {
        [RecipeDifficulty.EASY]: card.difficultyEasy,
        [RecipeDifficulty.MEDIUM]: card.difficultyMedium,
        [RecipeDifficulty.HARD]: card.difficultyHard,
    };
    const statusText: Record<RecipeCardStatus, string> = {
        draft: card.draftBadge,
        private: card.visibilityPrivate,
        public: card.visibilityPublic,
    };
    const wasEdited = recipe.updatedAt !== recipe.createdAt;
    const relativeTime = formatRelativeTime(wasEdited ? recipe.updatedAt : recipe.createdAt, now, locale, card.justNow);
    const timestamp = (wasEdited ? card.editedRelative : card.createdRelative).replace('{time}', relativeTime);
    const status = statusOf(recipe);
    const timeLabel = card.timeLabel.replace('{minutes}', String(recipe.totalTimeMinutes));
    // 0 or absent shows nothing (`buildSpec.md` §1.11): a draft with no times showed "⏱ 0 min" (F17).
    const duration = formatDuration(recipe.totalTimeMinutes * 60, copy.duration);

    return {
        recipe,
        cover: {
            noPhotoLabel: card.noPhotoLabel,
            pro: recipe.usesPremiumCapability ? { text: card.proBadge, label: card.proBadgeLabel } : undefined,
            status: status === 'public' ? undefined : { status, text: statusText[status] },
        },
        meta: {
            ...(duration === undefined ? {} : { duration }),
            timeLabel,
            difficulty: recipe.difficulty === undefined ? undefined : difficultyLabel[recipe.difficulty],
        },
        badges: {
            status: { status, text: statusText[status] },
            timestamp,
        },
        rating:
            recipe.averageRating === undefined || recipe.ratingCount === 0
                ? { kind: 'unrated', text: card.unrated }
                : {
                      kind: 'rated',
                      label: card.ratingSummary
                          .replace('{average}', formatAverageRating(recipe.averageRating, locale))
                          .replace(
                              '{ratings}',
                              formatRatingCount(
                                  recipe.ratingCount,
                                  { one: card.ratingCountOne, other: card.ratingCountOther },
                                  locale,
                              ),
                          ),
                      short: fillTemplate(card.ratingShort, {
                          average: formatAverageRating(recipe.averageRating, locale),
                          count: new Intl.NumberFormat(locale).format(recipe.ratingCount),
                      }),
                  },
    };
}
