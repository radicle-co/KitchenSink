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
 * Pure: the caller reads the clock and passes `now`.
 *
 * @pattern Presentation Model — the card's view, derived from its model and its copy
 */
import type { Locale } from '@commise/i18n';
import { RecipeDifficulty, RecipeStatus, RecipeVisibility } from '@kitchensink/recipe-core';

import { formatDurationMinutes } from '../list/model.js';
import type { RecipeMessages } from '../messages.js';
import {
    difficultyTone,
    formatAverageRating,
    formatRatingCount,
    formatRelativeTime,
    toStarFills,
    type DifficultyTone,
    type RecipeCardModel,
} from './model.js';

/** What every part of the card draws. */
export interface RecipeCardView {
    readonly recipe: RecipeCardModel;
    readonly cover: {
        readonly noPhotoLabel: string;
        /** The PRO badge, for a recipe that uses a premium capability only. */
        readonly pro: { readonly text: string; readonly label: string } | undefined;
    };
    readonly meta: {
        readonly duration: string;
        readonly timeLabel: string;
        readonly servingsLabel: string;
        /** The stated difficulty's pill, absent when the author stated none. */
        readonly difficulty: { readonly label: string; readonly tone: DifficultyTone } | undefined;
    };
    readonly badges: {
        /** The version badge, past v1 only. */
        readonly version: { readonly text: string; readonly label: string } | undefined;
        /** The draft badge, or the visibility badge: never both. */
        readonly status: { readonly kind: 'draft' | 'visibility'; readonly text: string };
        readonly timestamp: string;
    };
    readonly rating:
        | { readonly kind: 'unrated'; readonly text: string }
        | { readonly kind: 'rated'; readonly label: string; readonly fills: readonly boolean[] };
}

/**
 * The card's view. Pure.
 *
 * @param recipe - The card's model.
 * @param copy - The recipe copy: the card's own and the list's duration template.
 * @param locale - The active locale.
 * @param now - The current instant, in ISO 8601, read by the caller.
 * @returns What every part draws.
 */
export function recipeCardViewOf(
    recipe: RecipeCardModel,
    copy: Pick<RecipeMessages, 'card' | 'list'>,
    locale: Locale,
    now: string,
): RecipeCardView {
    const { card } = copy;
    const difficultyLabel: Record<RecipeDifficulty, string> = {
        [RecipeDifficulty.EASY]: card.difficultyEasy,
        [RecipeDifficulty.MEDIUM]: card.difficultyMedium,
        [RecipeDifficulty.HARD]: card.difficultyHard,
    };
    const wasEdited = recipe.updatedAt !== recipe.createdAt;
    const relativeTime = formatRelativeTime(wasEdited ? recipe.updatedAt : recipe.createdAt, now, locale, card.justNow);
    const version = String(recipe.currentVersion);

    return {
        recipe,
        cover: {
            noPhotoLabel: card.noPhotoLabel,
            pro: recipe.usesPremiumCapability ? { text: card.proBadge, label: card.proBadgeLabel } : undefined,
        },
        meta: {
            duration: formatDurationMinutes(recipe.totalTimeMinutes, copy.list.durationMinutes),
            timeLabel: card.timeLabel.replace('{minutes}', String(recipe.totalTimeMinutes)),
            servingsLabel: card.servingsLabel.replace('{count}', String(recipe.servings)),
            difficulty:
                recipe.difficulty === undefined
                    ? undefined
                    : { label: difficultyLabel[recipe.difficulty], tone: difficultyTone(recipe.difficulty) },
        },
        badges: {
            version:
                recipe.currentVersion > 1
                    ? {
                          text: card.versionBadge.replace('{version}', version),
                          label: card.versionLabel.replace('{version}', version),
                      }
                    : undefined,
            status:
                recipe.status === RecipeStatus.DRAFT
                    ? { kind: 'draft', text: card.draftBadge }
                    : {
                          kind: 'visibility',
                          text:
                              recipe.visibility === RecipeVisibility.PUBLIC
                                  ? card.visibilityPublic
                                  : card.visibilityPrivate,
                      },
            timestamp: (wasEdited ? card.editedRelative : card.createdRelative).replace('{time}', relativeTime),
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
                      fills: toStarFills(recipe.averageRating),
                  },
    };
}
