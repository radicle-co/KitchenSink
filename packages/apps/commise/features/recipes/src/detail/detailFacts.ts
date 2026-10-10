/**
 * @module @commise/features-recipes — the recipe page's derived facts (`docs/design/uiOverhaul/buildSpec.md` §6.1,
 * §6.3): the stat strip, the meta line, the rating line, and each ingredient row's name and statuses.
 *
 * Read by BOTH platform leaves, so the two cannot disagree about what a cell says, when a cell hides, or what a
 * checkable row is named. Every function here is pure.
 */
import type { Locale } from '@commise/i18n';
import { RecipeStatus, RecipeVisibility, type RecipeDetail, type RecipeIngredientView } from '@kitchensink/recipe-core';

import { formatDuration } from '../format/duration.js';
import { fillTemplate } from '../format/fillTemplate.js';
import type {
    IngredientLineNameMessages,
    RecipeCardMessages,
    RecipeDetailMessages,
    RecipeDurationMessages,
} from '../messages.js';
import {
    ingredientCheckLabel,
    isLineAmbiguous,
    isLineFoodRemoved,
    isLineNeedsReview,
    type DetailNativeLayout,
} from './model.js';
import { isStandInName } from './lineName.js';

/** A recipe's stated difficulty. */
type DifficultyLevel = NonNullable<RecipeDetail['difficulty']>;

/** One cell of the stat strip. A difficulty cell also carries its level, which the meter draws. */
export type DetailStatCell =
    | { readonly id: 'total' | 'prep' | 'cook'; readonly label: string; readonly value: string }
    | { readonly id: 'difficulty'; readonly label: string; readonly value: string; readonly level: DifficultyLevel };

/** The timings the strip reads: the scaled projection's, so prep and total follow the serving count. */
interface StripTimings {
    readonly totalTimeMinutes: number;
    readonly prepTimeMinutes: number;
    readonly cookTimeMinutes: number;
}

/** The words of each difficulty. */
const difficultyWord = (level: DifficultyLevel, card: RecipeCardMessages): string =>
    ({ easy: card.difficultyEasy, medium: card.difficultyMedium, hard: card.difficultyHard })[level];

/** A time in minutes as the strip says it, or `undefined` for a missing time — never "0 min". */
const timeValue = (minutes: number, duration: RecipeDurationMessages): string | undefined =>
    minutes > 0 ? formatDuration(minutes * 60, duration) : undefined;

/**
 * The stat strip: Total, Prep, Cook and Difficulty, in that order; a missing time or difficulty hides its cell.
 *
 * @param timings - The timings, in minutes.
 * @param difficulty - The stated difficulty, if any.
 * @param messages - The detail, duration and card copy.
 * @returns The cells to draw.
 */
export function detailStatCells(
    timings: StripTimings,
    difficulty: DifficultyLevel | undefined,
    messages: {
        readonly detail: RecipeDetailMessages;
        readonly duration: RecipeDurationMessages;
        readonly card: RecipeCardMessages;
    },
): readonly DetailStatCell[] {
    const { detail, duration, card } = messages;
    const times: readonly {
        readonly id: 'total' | 'prep' | 'cook';
        readonly label: string;
        readonly minutes: number;
    }[] = [
        { id: 'total', label: detail.totalLabel, minutes: timings.totalTimeMinutes },
        { id: 'prep', label: detail.prepLabel, minutes: timings.prepTimeMinutes },
        { id: 'cook', label: detail.cookLabel, minutes: timings.cookTimeMinutes },
    ];
    const cells: DetailStatCell[] = times.flatMap(({ id, label, minutes }) => {
        const value = timeValue(minutes, duration);

        return value === undefined ? [] : [{ id, label, value }];
    });

    if (difficulty !== undefined) {
        cells.push({
            id: 'difficulty',
            label: detail.difficultyLabel,
            value: difficultyWord(difficulty, card),
            level: difficulty,
        });
    }

    return cells;
}

/**
 * The meta line above the title: the cuisine, then — on another cook's recipe — "by @handle".
 *
 * @param recipe - The recipe.
 * @param viewerIsOwner - Whether the viewer owns it; the viewer is never named as their own recipe's author.
 * @param detail - The detail copy.
 * @returns The items, in order.
 */
export function detailMetaItems(
    recipe: Pick<RecipeDetail, 'cuisine' | 'authorHandle'>,
    viewerIsOwner: boolean,
    detail: RecipeDetailMessages,
): readonly string[] {
    const items: string[] = [];

    if (recipe.cuisine !== undefined && recipe.cuisine !== '') {
        items.push(recipe.cuisine);
    }

    if (!viewerIsOwner && recipe.authorHandle !== undefined && recipe.authorHandle !== '') {
        items.push(fillTemplate(detail.byAuthor, { handle: recipe.authorHandle }));
    }

    return items;
}

/** The status at the end of the rating line: the owner's visibility, or the owner's Draft badge. */
export type DetailStatus =
    | { readonly kind: 'visibility'; readonly visibility: 'public' | 'private'; readonly text: string }
    | { readonly kind: 'draft'; readonly text: string };

/** The rating line under the title. */
export interface DetailRatingLine {
    /** The average and count; absent for a recipe nobody has rated. */
    readonly rating: { readonly stars: number; readonly text: string } | undefined;
    /** The owner's status; absent for another cook's viewer. */
    readonly status: DetailStatus | undefined;
}

/**
 * The rating line: "4.8 (12)" and, for the owner, the visibility or the Draft badge.
 *
 * @param recipe - The recipe.
 * @param viewerIsOwner - Whether the viewer owns it.
 * @param locale - The active locale, for the average.
 * @param messages - The detail and card copy.
 * @returns The line's parts.
 */
export function detailRatingLine(
    recipe: Pick<RecipeDetail, 'averageRating' | 'ratingCount' | 'visibility' | 'status'>,
    viewerIsOwner: boolean,
    locale: Locale,
    messages: { readonly detail: RecipeDetailMessages; readonly card: RecipeCardMessages },
): DetailRatingLine {
    const { detail, card } = messages;
    const rating =
        recipe.averageRating === undefined || recipe.ratingCount === 0
            ? undefined
            : {
                  stars: recipe.averageRating,
                  text: fillTemplate(card.ratingShort, {
                      average: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(recipe.averageRating),
                      count: recipe.ratingCount,
                  }),
              };

    if (!viewerIsOwner) {
        return { rating, status: undefined };
    }

    if (recipe.status === RecipeStatus.DRAFT) {
        return { rating, status: { kind: 'draft', text: card.draftBadge } };
    }

    const isPublic = recipe.visibility === RecipeVisibility.PUBLIC;

    return {
        rating,
        status: {
            kind: 'visibility',
            visibility: isPublic ? 'public' : 'private',
            text: isPublic ? detail.visibilityPublic : detail.visibilityPrivate,
        },
    };
}

/**
 * A checkable ingredient row's name: the whole line — amount, food (and a variant's parts) and preparation — because
 * the whole row is the checkbox.
 *
 * @param line - The line, at the serving count on screen.
 * @param locale - The active locale.
 * @param labels - The stand-ins for a line with no name.
 * @param withDetails - The `checkLabelWithDetails` template.
 * @returns The name.
 */
export function ingredientRowName(
    line: RecipeIngredientView,
    locale: Locale,
    labels: IngredientLineNameMessages,
    withDetails: string,
): string {
    const preparation = line.preparation?.trim() ?? '';
    const name = ingredientCheckLabel(line, locale, labels, withDetails);

    return preparation === '' ? name : `${name}, ${preparation}`;
}

/** One consecutive run of ingredient lines under one group label. */
export interface IngredientGroupRun<T> {
    /** The group's label, trimmed; absent for an ungrouped run, which draws no heading. */
    readonly label?: string;
    /** The run's lines, in stored order. */
    readonly lines: readonly T[];
}

/**
 * Fold the lines into consecutive runs by group label (§6.1, F9): the page draws an overline over each labelled run.
 *
 * ⛔ By CONSECUTIVE run, never by label identity: `[A][B][A]` is three runs in that order, because grouping by label
 * would reorder the recipe. A blank label is no group. This is the read side of the editor's fold over form values
 * (`ingredientSections`, `form/props.ts`), which changes for editor reasons; the two read the same stored field. Pure.
 *
 * @param lines - The lines, in stored order.
 * @returns The runs, in stored order; empty for no lines.
 */
export function ingredientGroupRuns<T extends { readonly groupLabel?: string }>(
    lines: readonly T[],
): readonly IngredientGroupRun<T>[] {
    return lines.reduce<IngredientGroupRun<T>[]>((runs, line) => {
        const trimmed = line.groupLabel?.trim() ?? '';
        const label = trimmed === '' ? undefined : trimmed;
        const previous = runs[runs.length - 1];

        if (previous !== undefined && previous.label === label) {
            return [...runs.slice(0, -1), { ...previous, lines: [...previous.lines, line] }];
        }

        return [...runs, { ...(label === undefined ? {} : { label }), lines: [line] }];
    }, []);
}

/** One nutrition figure: its label and its value as shown. */
export interface NutritionCell {
    readonly label: string;
    readonly value: string;
}

/** The four nutrition figures, and whether nothing was counted. */
export interface NutritionCells {
    readonly cells: readonly NutritionCell[];
    /** No line was counted: every cell is a dash and the section says so in one line. */
    readonly noneCounted: boolean;
}

/** What an uncounted figure shows (`buildSpec.md` §6.7, "Nutrition unavailable"). */
const NO_FIGURE = '—';

/**
 * The four per-serving figures (calories, protein, carbs, fat). A partial estimate that counted NOTHING — every figure
 * zero, not complete — shows "—" in each cell: "0 / 0 g" read as a measured zero (F17). A complete recipe keeps its
 * zeros, which are measurements. Pure.
 *
 * @param nutrition - The stored per-serving figures.
 * @param detail - The detail copy (labels and the grams template).
 * @returns The cells, in order, and whether nothing was counted.
 */
export function nutritionCells(
    nutrition: Pick<RecipeDetail['nutrition'], 'calories' | 'proteinG' | 'carbsG' | 'fatG' | 'isComplete'>,
    detail: RecipeDetailMessages,
): NutritionCells {
    const noneCounted =
        !nutrition.isComplete &&
        nutrition.calories === 0 &&
        nutrition.proteinG === 0 &&
        nutrition.carbsG === 0 &&
        nutrition.fatG === 0;
    const grams = (value: number): string =>
        noneCounted ? NO_FIGURE : fillTemplate(detail.gramsUnit, { grams: value });

    return {
        noneCounted,
        cells: [
            { label: detail.caloriesLabel, value: noneCounted ? NO_FIGURE : String(nutrition.calories) },
            { label: detail.proteinLabel, value: grams(nutrition.proteinG) },
            { label: detail.carbsLabel, value: grams(nutrition.carbsG) },
            { label: detail.fatLabel, value: grams(nutrition.fatG) },
        ],
    };
}

/** One status badge on an ingredient row. */
export interface IngredientRowStatus {
    readonly tone: 'note' | 'attention';
    readonly text: string;
}

/**
 * The status badges an ingredient row carries, in order. The removed-food badge is dropped when every line is
 * removed (the section's tile says it once) and on a line whose stand-in already says it.
 *
 * @param line - The line.
 * @param allRemoved - Whether every line of the recipe is removed (`allLinesFoodRemoved`).
 * @param detail - The detail copy.
 * @returns The badges.
 */
export function ingredientRowStatuses(
    line: RecipeIngredientView,
    allRemoved: boolean,
    detail: RecipeDetailMessages,
): readonly IngredientRowStatus[] {
    const statuses: IngredientRowStatus[] = [];

    if (line.isUserEntered) {
        statuses.push({ tone: 'note', text: detail.userEnteredBadge });
    }

    if (isLineNeedsReview(line)) {
        statuses.push({ tone: 'attention', text: detail.needsReviewBadge });
    }

    if (isLineAmbiguous(line)) {
        statuses.push({ tone: 'attention', text: detail.ambiguousBadge });
    }

    if (isLineFoodRemoved(line) && !isStandInName(line) && !allRemoved) {
        statuses.push({ tone: 'attention', text: detail.removedFoodBadge });
    }

    return statuses;
}

/** About four lines of `readingBody` at a 320–390 px column. */
const LONG_DESCRIPTION_CHARS = 180;

/**
 * Whether a description is long enough to be clamped at four lines on a phone, which is when "More" is offered. A
 * character count rather than a measurement: a measurement needs a ref and a layout read, and the cost of the
 * heuristic is a "More" that expands two words. Pure.
 *
 * @param description - The description.
 * @returns `true` above 180 characters.
 */
export function isLongDescription(description: string): boolean {
    return description.length > LONG_DESCRIPTION_CHARS;
}

/** The body width from which the page shows two columns (§6.1). */
const TWO_COLUMN_BODY = 720;

/** The strip width below which the stat strip is two cells to a row (§6.1). */
const TWO_BY_TWO_STRIP = 360;

/**
 * The native page's layout for a body width — the thresholds the web leaf reads through container queries. Pure.
 *
 * @param bodyWidth - The width the page's content gets, in points (the window less its gutters).
 * @returns Its columns, and how many stat cells fit a row.
 */
export function detailNativeLayoutOf(bodyWidth: number): DetailNativeLayout {
    const columns = bodyWidth >= TWO_COLUMN_BODY ? 'two' : 'one';
    // In two columns the strip sits in the full-width top, so only the one-column width can fall below 360.
    const statsPerRow = bodyWidth < TWO_BY_TWO_STRIP ? 2 : 4;

    return { columns, statsPerRow };
}
