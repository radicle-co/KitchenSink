/**
 * @module @commise/features-recipes — the recipe page's derived facts (`docs/design/uiOverhaul/buildSpec.md` §6.1,
 * §6.3): the stat strip, the meta line, the rating line, and each ingredient row's name and statuses.
 *
 * Read by BOTH platform leaves, so the two cannot disagree about what a cell says, when a cell hides, or what a
 * checkable row is named. Every function here is pure.
 */
import type { ReactNode } from 'react';
import { type Locale, fillTemplate } from '@commise/i18n';
import { RecipeStatus, RecipeVisibility, type RecipeDetail, type RecipeIngredientView } from '@kitchensink/recipe-core';

import { formatCalories } from '../card/model.js';
import { controlName } from '../format/cookAmount.js';
import { formatDuration } from '../format/duration.js';
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
    lineTailOf,
    needsReviewNotice,
    rangeDerivedNotice,
    staleNutritionNotice,
    type DetailNativeLayout,
} from './model.js';
import { isStandInName } from './lineName.js';
import { bylineOf } from '../byline/bylineOf.js';
import { bylineText } from '../byline/bylineText.js';
import type { BylineMessages } from '../byline/messages.js';

/** A recipe's stated difficulty. */
type DifficultyLevel = NonNullable<RecipeDetail['difficulty']>;

/** One fact tile. A difficulty tile also carries its level, which the meter draws. */
export type DetailStatCell =
    | { readonly id: 'total' | 'prep'; readonly label: string; readonly value: string }
    | { readonly id: 'difficulty'; readonly label: string; readonly value: string };

/** The timings the tiles read: the scaled projection's, so prep and total follow the serving count. */
interface StripTimings {
    readonly totalTimeMinutes: number;
    readonly prepTimeMinutes: number;
}

/** The words of each difficulty. */
const difficultyWord = (level: DifficultyLevel, card: RecipeCardMessages): string =>
    ({ easy: card.difficultyEasy, medium: card.difficultyMedium, hard: card.difficultyHard })[level];

/** A time in minutes as the strip says it, or `undefined` for a missing time — never "0 min". */
const timeValue = (minutes: number, duration: RecipeDurationMessages): string | undefined =>
    minutes > 0 ? formatDuration(minutes * 60, duration) : undefined;

/**
 * The fact tiles: Total, Prep and Difficulty, in that order; a missing time or difficulty hides its tile. There is no
 * Cook tile (`RecipeDetailAndroid384`, `nativeBoards/buildLists.md` item 6).
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
        readonly id: 'total' | 'prep';
        readonly label: string;
        readonly minutes: number;
    }[] = [
        { id: 'total', label: detail.totalLabel, minutes: timings.totalTimeMinutes },
        { id: 'prep', label: detail.prepLabel, minutes: timings.prepTimeMinutes },
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
        });
    }

    return cells;
}

/**
 * The eyebrow above the title: the cuisine, alone (`RecipeDetailAndroid384`). The byline is a line of its own.
 *
 * @param recipe - The recipe.
 * @returns The cuisine, or `undefined` when the recipe states none.
 */
export function detailEyebrow(recipe: Pick<RecipeDetail, 'cuisine'>): string | undefined {
    return recipe.cuisine === undefined || recipe.cuisine === '' ? undefined : recipe.cuisine;
}

/**
 * The byline of another cook's recipe — "by Display Name", or "by @username" for an author with no display name, or "by
 * a former member" (designer, `designAnswers.md` 2026-11-02: the display name alone, until recipes carry a handle). The
 * viewer is never named as their own recipe's author, and an imported recipe with no author gets none: its source line
 * says where it came from.
 *
 * @param recipe - The recipe.
 * @param viewerIsOwner - Whether the viewer owns it.
 * @param detail - The detail copy.
 * @param byline - The byline copy.
 * @returns The line, or `undefined` when there is nobody to name.
 */
export function detailByline(
    recipe: Pick<RecipeDetail, 'authorDisplayName' | 'authorUsername'>,
    viewerIsOwner: boolean,
    detail: RecipeDetailMessages,
    byline: BylineMessages,
): string | undefined {
    if (viewerIsOwner) {
        return undefined;
    }

    const who = bylineOf({
        ...(recipe.authorUsername === undefined ? {} : { username: recipe.authorUsername }),
        ...(recipe.authorDisplayName === undefined ? {} : { displayName: recipe.authorDisplayName }),
    });
    // A cook with both is shown by display name alone; the shared rule still decides who has no name to show.
    const shown =
        who.kind === 'person' && who.displayName !== undefined
            ? { kind: 'name' as const, displayName: who.displayName }
            : who;
    const author = bylineText(shown, byline, 'sentence');

    return author === undefined ? undefined : fillTemplate(detail.byAuthor, { byline: author });
}

/** The owner's status beside the version link: the visibility, or the Draft badge. */
export type DetailStatus =
    | { readonly kind: 'visibility'; readonly visibility: 'public' | 'private'; readonly text: string }
    | { readonly kind: 'draft'; readonly text: string };

/**
 * The owner's status: the visibility, or the Draft badge for a draft. Another cook's viewer sees none. The rating is
 * NOT here: the rating card owns it.
 *
 * @param recipe - The recipe.
 * @param viewerIsOwner - Whether the viewer owns it.
 * @param messages - The detail and card copy.
 * @returns The status, or `undefined` for a viewer who is not the owner.
 */
export function detailStatusLine(
    recipe: Pick<RecipeDetail, 'visibility' | 'status'>,
    viewerIsOwner: boolean,
    messages: { readonly detail: RecipeDetailMessages; readonly card: RecipeCardMessages },
): DetailStatus | undefined {
    const { detail, card } = messages;

    if (!viewerIsOwner) {
        return undefined;
    }

    if (recipe.status === RecipeStatus.DRAFT) {
        return { kind: 'draft', text: card.draftBadge };
    }

    const isPublic = recipe.visibility === RecipeVisibility.PUBLIC;

    return {
        kind: 'visibility',
        visibility: isPublic ? 'public' : 'private',
        text: isPublic ? detail.visibilityPublic : detail.visibilityPrivate,
    };
}

/**
 * A checkable ingredient row's name: the whole line — amount, food (and a variant's parts) and preparation — because
 * the whole row is the checkbox. Being a control, it is named by its visible text, glyph included (WCAG 2.5.3, option C).
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
    const name = ingredientCheckLabel(line, locale, labels, withDetails);

    return controlName([name, ...lineTailOf(line).map((words) => words.trim())].join(', '));
}

/** The `reviewAction` prop for a control, or nothing when the line has none (`exactOptionalPropertyTypes`). Pure. */
export const withReviewAction = (control: ReactNode): { readonly reviewAction?: ReactNode } =>
    control === undefined || control === null ? {} : { reviewAction: control };

/** One consecutive run of ingredient lines under one group label. */
export interface IngredientGroupRun<T> {
    /** The group's label, trimmed; absent for an ungrouped run, which draws no heading. */
    readonly label?: string;
    /** The run's lines, in stored order. */
    readonly lines: readonly T[];
}

/**
 * Fold the lines into consecutive runs by group label (§6.1, F9): the page draws a label over each labelled run.
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
 * zero, not complete — shows "—" in each cell: "0 / 0 g" read as a measured zero (F17). A recipe with NO lines counts
 * nothing too: its sum over nothing is a "complete" zero, and the same dashes are the honest cell (D2). A complete
 * recipe WITH lines keeps its zeros, which are measurements. Pure.
 *
 * The figures are whole numbers grouped for the locale (D11), through the card's own `formatCalories`: the server's
 * rounding to one decimal is not for the reader.
 *
 * @param nutrition - The stored per-serving figures.
 * @param ingredients - The recipe's lines: none means nothing could have been counted.
 * @param detail - The detail copy (labels and the grams template).
 * @param locale - The active locale.
 * @returns The cells, in order, and whether nothing was counted.
 */
export function nutritionCells(
    nutrition: Pick<RecipeDetail['nutrition'], 'calories' | 'proteinG' | 'carbsG' | 'fatG' | 'isComplete'>,
    ingredients: readonly RecipeIngredientView[],
    detail: RecipeDetailMessages,
    locale: Locale,
): NutritionCells {
    const noneCounted =
        ingredients.length === 0 ||
        (!nutrition.isComplete &&
            nutrition.calories === 0 &&
            nutrition.proteinG === 0 &&
            nutrition.carbsG === 0 &&
            nutrition.fatG === 0);
    const grams = (value: number): string =>
        noneCounted ? NO_FIGURE : fillTemplate(detail.gramsUnit, { grams: formatCalories(value, locale) });

    return {
        noneCounted,
        cells: [
            {
                label: detail.caloriesLabel,
                value: noneCounted ? NO_FIGURE : formatCalories(nutrition.calories, locale),
            },
            { label: detail.proteinLabel, value: grams(nutrition.proteinG) },
            { label: detail.carbsLabel, value: grams(nutrition.carbsG) },
            { label: detail.fatLabel, value: grams(nutrition.fatG) },
        ],
    };
}

/**
 * The nutrition row's collapsed summary: "{n} cal per serving", or "Not counted yet" when no food was counted (there is
 * no calorie figure to give, and a "0 cal" would read as a measurement). Pure; shared so the two platforms word it alike.
 *
 * @param cells - The cells {@link nutritionCells} answered.
 * @param detail - The detail copy.
 * @returns The summary.
 */
function nutritionSummary(
    cells: NutritionCells,
    detail: Pick<RecipeDetailMessages, 'nutritionSummary' | 'nutritionSummaryNone'>,
): string {
    const calories = cells.cells[0]?.value;

    return cells.noneCounted || calories === undefined
        ? detail.nutritionSummaryNone
        : fillTemplate(detail.nutritionSummary, { calories });
}

/**
 * The ONE line under the nutrition figures that says why they are what they are (A-015). Pure.
 *
 * Nothing counted and nothing withheld → no ingredient has a food. Some counted and some did not → partial. Nothing
 * counted BECAUSE the lines are withheld for review → nothing here: "no ingredient has a food" is false (each has one),
 * and the review notice, drawn beside it, already says what happened. The page used to print both.
 *
 * @param state - Whether nothing was counted, whether the estimate is complete, and the review notice if there is one.
 * @param detail - The detail copy.
 * @returns The line, or `undefined` when there is none to add.
 */
export function nutritionStatusLine(
    state: {
        readonly noneCounted: boolean;
        readonly isComplete: boolean;
        readonly reviewNotice: string | undefined;
    },
    detail: Pick<RecipeDetailMessages, 'nutritionNoneCounted' | 'nutritionPartial'>,
): string | undefined {
    if (state.noneCounted) {
        return state.reviewNotice === undefined ? detail.nutritionNoneCounted : undefined;
    }

    return state.isComplete ? undefined : detail.nutritionPartial;
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
 * @param reviewControl - The owner's review control carries the "Needs review" badge itself, so the row leaves it out.
 * @returns The badges.
 */
export function ingredientRowStatuses(
    line: RecipeIngredientView,
    allRemoved: boolean,
    detail: RecipeDetailMessages,
    reviewControl = false,
): readonly IngredientRowStatus[] {
    const statuses: IngredientRowStatus[] = [];

    if (line.isUserEntered) {
        statuses.push({ tone: 'note', text: detail.userEnteredBadge });
    }

    if (isLineNeedsReview(line) && !reviewControl) {
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
 * Whether a description is long enough to be clamped at four lines on a phone, which is when "Read more" is offered. A
 * character count rather than a measurement: a measurement needs a ref and a layout read, and the cost of the
 * heuristic is a "Read more" that expands two words. Pure.
 *
 * @param description - The description.
 * @returns `true` above 180 characters.
 */
export function isLongDescription(description: string): boolean {
    return description.length > LONG_DESCRIPTION_CHARS;
}

/** The body width from which the page shows two columns (§6.1). */
const TWO_COLUMN_BODY = 720;

/**
 * The native page's layout for a body width: one column, or two from a 720 pt body (§6.1) — the threshold the web leaf
 * reads through container queries — and the room the fact tiles are drawn in. Pure, and in points: the font scale does not
 * move the column rule.
 *
 * @param bodyWidth - The width the page's content gets, in points (the window less its gutters).
 * @param textScale - The scale the text is drawn at (`cappedFontScale` of the system's), which the fact tiles read.
 * @returns Its column count, and the body width and text scale the tiles lay out by.
 */
export function detailNativeLayoutOf(bodyWidth: number, textScale: number): DetailNativeLayout {
    return { columns: bodyWidth >= TWO_COLUMN_BODY ? 'two' : 'one', bodyWidth, textScale };
}

/** What the nutrition row shows, derived once for both platforms. */
export interface NutritionSectionFacts {
    /** The four figures, and whether nothing was counted. */
    readonly cells: NutritionCells;
    /** The collapsed row's second line: "{n} cal per serving" or "Not counted yet". */
    readonly summary: string;
    /** The one line saying why the figures are what they are, if there is one. */
    readonly statusLine: string | undefined;
    /** The range-derived caveat, if the stored figure carries one. */
    readonly rangeNotice: string | undefined;
    /** The stale caveat, if the stored figure carries one. */
    readonly staleNotice: string | undefined;
    /** Our own doubt about a line's food, if any line is withheld for review. */
    readonly reviewNotice: string | undefined;
}

/**
 * Everything the nutrition row reads off a recipe: the figures, the summary and every caveat. Pure. Facts about the READ,
 * from the stored figure, not the serving count on screen. One derivation for the web and native rows, so they cannot
 * word a caveat differently.
 *
 * @param recipe - The recipe.
 * @param detail - The detail copy.
 * @param locale - The active locale.
 * @returns The facts.
 */
export function nutritionSectionFacts(
    recipe: Pick<RecipeDetail, 'nutrition' | 'ingredients'>,
    detail: RecipeDetailMessages,
    locale: Locale,
): NutritionSectionFacts {
    const cells = nutritionCells(recipe.nutrition, recipe.ingredients, detail, locale);
    const reviewNotice = needsReviewNotice(recipe.ingredients, detail);

    return {
        cells,
        summary: nutritionSummary(cells, detail),
        statusLine: nutritionStatusLine(
            { noneCounted: cells.noneCounted, isComplete: recipe.nutrition.isComplete, reviewNotice },
            detail,
        ),
        rangeNotice: rangeDerivedNotice(recipe.nutrition, {
            low: detail.nutritionRangeDerivedLow,
            high: detail.nutritionRangeDerivedHigh,
        }),
        staleNotice: staleNutritionNotice(recipe.nutrition, detail.nutritionStale),
        reviewNotice,
    };
}
