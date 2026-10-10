/**
 * @module @commise/features-recipes/card — what every part of the recipe card draws, derived once from the card's model
 * and copy, shared by the web and native `RecipeCard` leaves (W9-f P7).
 *
 * The card's design rules are decided here, so the two leaves cannot drift on them: an ABSENT difficulty offers no pill,
 * never a default (FR-001b); the PRO badge follows the materialized `usesPremiumCapability` flag (FR-003a); the version
 * badge shows only past v1; a draft's badge REPLACES the visibility badge, because a free-tier draft is
 * `visibility='public'` while nobody else can see it; the timestamp says "Created" until the recipe is first revised,
 * then "Edited" (CR-002); and an unrated recipe says so, never a 0-star score.
 *
 * Slice 4 of the UI overhaul (`docs/design/uiOverhaul/buildSpec.md` §4.1) adds what the three variants draw: the cover's
 * status chip (a draft or a private recipe only — a published public recipe is the quiet case) and its time chip in
 * hours and minutes, the difficulty's LEVEL (tint + meter + word, never colour alone, and never `error`), the tags as one
 * line of text with "+N", the footer that joins the version and the timestamp, and the short "4.8 (12)" rating figure.
 *
 * Pure: the caller reads the clock and passes `now`.
 *
 * @pattern Presentation Model — the card's view, derived from its model and its copy
 */
import type { Locale } from '@commise/i18n';
import { RecipeDifficulty, RecipeStatus, RecipeVisibility } from '@kitchensink/recipe-core';

import { formatDuration } from '../format/duration.js';
import { fillTemplate } from '../format/fillTemplate.js';
import type { RecipeMessages } from '../messages.js';
import {
    formatAverageRating,
    formatRatingCount,
    formatRelativeTime,
    toStarFills,
    type RecipeCardModel,
} from './model.js';

/** A difficulty's level, which picks its tint and how many of the meter's three dots are filled. */
export type DifficultyLevel = 'easy' | 'medium' | 'hard';

/** A recipe's publication status, as the design-system badge names it. */
export type RecipeCardStatus = 'draft' | 'private' | 'public';

/** How many tags a card names before it counts the rest. */
export const CARD_TAGS_SHOWN = 2;

/** What every part of the card draws. */
export interface RecipeCardView {
    readonly recipe: RecipeCardModel;
    readonly cover: {
        readonly noPhotoLabel: string;
        /** The PRO badge, for a recipe that uses a premium capability only. */
        readonly pro: { readonly text: string; readonly label: string } | undefined;
        /** The status chip: a draft or a private recipe only. */
        readonly status: { readonly status: Exclude<RecipeCardStatus, 'public'>; readonly text: string } | undefined;
        /** The total-time chip, in hours and minutes, with its spoken name. Absent when the recipe states no time. */
        readonly time?: { readonly text: string; readonly label: string };
    };
    readonly meta: {
        readonly duration?: string;
        readonly timeLabel: string;
        readonly servingsLabel: string;
        /** The servings as a phrase for a meta line ("Serves 8"). */
        readonly servingsText: string;
        /** The stated difficulty, absent when the author stated none. */
        readonly difficulty: { readonly label: string; readonly level: DifficultyLevel } | undefined;
    };
    readonly badges: {
        /** The version badge, past v1 only. */
        readonly version: { readonly text: string; readonly label: string } | undefined;
        /** Draft, or the visibility: never both, because a free-tier draft is `public` while nobody else sees it. */
        readonly status: { readonly status: RecipeCardStatus; readonly text: string };
        readonly timestamp: string;
    };
    /** The version (past v1) and the timestamp on one line. */
    readonly footer: string;
    /** The tags as one line of text, with its full list as a name. Absent for a recipe with no tags. */
    readonly tags: { readonly text: string; readonly label: string } | undefined;
    /** The separator between the items of one line, from the locale. */
    readonly separator: string;
    readonly rating:
        | { readonly kind: 'unrated'; readonly text: string }
        | {
              readonly kind: 'rated';
              readonly label: string;
              readonly fills: readonly boolean[];
              /** The figure beside the stars, e.g. "4.8 (12)". */
              readonly short: string;
          };
}

const LEVEL: Record<RecipeDifficulty, DifficultyLevel> = {
    [RecipeDifficulty.EASY]: 'easy',
    [RecipeDifficulty.MEDIUM]: 'medium',
    [RecipeDifficulty.HARD]: 'hard',
};

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
    const version = String(recipe.currentVersion);
    const versionBadge =
        recipe.currentVersion > 1
            ? {
                  text: card.versionBadge.replace('{version}', version),
                  label: card.versionLabel.replace('{version}', version),
              }
            : undefined;
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
            ...(duration === undefined ? {} : { time: { text: duration, label: timeLabel } }),
        },
        meta: {
            ...(duration === undefined ? {} : { duration }),
            timeLabel,
            servingsLabel: card.servingsLabel.replace('{count}', String(recipe.servings)),
            servingsText: card.servingsLabel.replace('{count}', String(recipe.servings)),
            difficulty:
                recipe.difficulty === undefined
                    ? undefined
                    : { label: difficultyLabel[recipe.difficulty], level: LEVEL[recipe.difficulty] },
        },
        badges: {
            version: versionBadge,
            status: { status, text: statusText[status] },
            timestamp,
        },
        footer: versionBadge === undefined ? timestamp : [versionBadge.text, timestamp].join(card.separator),
        tags: tagsLineOf(recipe.tags, card),
        separator: card.separator,
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
                      fills: toStarFills(recipe.averageRating),
                      short: fillTemplate(card.ratingShort, {
                          average: formatAverageRating(recipe.averageRating, locale),
                          count: new Intl.NumberFormat(locale).format(recipe.ratingCount),
                      }),
                  },
    };
}

/**
 * The tags as one line of text: the first {@link CARD_TAGS_SHOWN}, then "+N" for the rest. The full list is its name, so
 * nothing the line counts is out of reach. Pure.
 *
 * @param tags - The recipe's tags.
 * @param card - The card copy.
 * @returns The line, or `undefined` for no tags.
 */
function tagsLineOf(
    tags: readonly string[],
    card: Pick<RecipeMessages['card'], 'moreTags' | 'separator'>,
): RecipeCardView['tags'] {
    if (tags.length === 0) {
        return undefined;
    }

    const shown = tags.slice(0, CARD_TAGS_SHOWN);
    const rest = tags.length - shown.length;
    const parts = rest > 0 ? [...shown, fillTemplate(card.moreTags, { count: rest })] : shown;

    return { text: parts.join(card.separator), label: tags.join(', ') };
}
