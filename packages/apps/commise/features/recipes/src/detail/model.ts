/**
 * @module @commise/features-recipes — recipe-detail model layer.
 *
 * Pure, platform-agnostic helpers + props shared by the web (`*.tsx`) and native (`*.native.tsx`) detail
 * views. The detail render consumes a {@link RecipeDetail} directly (it is already the read model); the
 * only shaping needed is small formatting the two platforms must not diverge on.
 */
import type { ReactNode } from 'react';

import type { Locale } from '@commise/i18n';
import { spokenVariantParts } from '@commise/ui/variant-parts-line';
import { FoodResolutionStatus } from '@kitchensink/recipe-core';
import { servingsRange } from '@kitchensink/recipe-core/scaling';
import type {
    IngredientQuantity,
    RecipePhoto,
    RecipeDetail,
    RecipeIngredient,
    RecipeDetailNutrition,
    RecipeIngredientView,
    RecipeNutrition,
} from '@kitchensink/recipe-core';

import type { RecipeFormMessages } from '../form/messages.js';
import {
    sourceDisplayName,
    sourceNotesOf,
    unsearchedSentenceOf,
    type ProgressiveNotesCopy,
    type SourceNaming,
} from '../form/progressiveNotes.js';
import {
    remotePickOf,
    servedFoodsOf,
    type AnswerProgress,
    type DatabasePart,
    type EntrySearchView,
    type RemotePart,
} from '../hooks/foodSuggestions.model.js';
import type { RemoteFoodPick } from '../hooks/lineCommit.js';
import { fillTemplate, formatDuration } from '../list/model.js';
import type {
    IngredientLineNameMessages,
    IngredientRemoteSearchMessages,
    RecipeDurationMessages,
} from '../messages.js';
import type { RefreshNoticeControl, RetryControl } from '../refresh/model.js';
import { lineDisplayName, snapshotLineName, variantPartTexts, type NameableLine } from './lineName.js';

/**
 * Separates the two bounds of a stated range (`2–3 cups`).
 *
 * ⛔ NOT `Intl.NumberFormat.prototype.formatRange`, which is the obvious library-first answer and is wrong
 * HERE: this formatter is shared verbatim by web and by React Native, Hermes delegates `Intl` to the
 * platform's own formatter, and the app polyfills `PluralRules`/`RelativeTimeFormat`/`Locale` but NOT
 * `NumberFormat`. Feature-detecting it would be worse than not using it — the two platforms would then
 * render the same recipe differently, which is exactly what §14's shared-model rule exists to prevent. Each
 * BOUND still goes through `Intl.NumberFormat`, so grouping and decimal separators stay locale-correct;
 * only the glyph between them is fixed.
 *
 * An EN DASH, deliberately: it is the typographic convention for a numeric span in every locale this ships
 * to, and it is punctuation rather than copy, so it does not belong in the message catalogue.
 *
 * U9 reviewed this and KEPT it, on the reasoning above rather than by inheritance: `formatRange` would need
 * a `NumberFormat` polyfill decision before it could be used, and the same glyph is now also what separates
 * the editor's two numeric inputs, so the read and the write surface use one separator on both platforms.
 */
const RANGE_SEPARATOR = '–';

/**
 * Format an ingredient quantity with its optional unit for the active locale via {@link Intl.NumberFormat}
 * (never string concatenation of the NUMBERS, so grouping/decimal separators stay locale-correct). Mirrors
 * `card/model.ts`'s `formatCalories`. Pure.
 *
 * Each of the value object's three members renders differently, and the third is the one to be careful
 * about:
 *
 * | Member   | Example input                 | Renders     |
 * | -------- | ----------------------------- | ----------- |
 * | `exact`  | `{ value: 1.5 }`, `'lbs'`     | `1.5 lbs`   |
 * | `range`  | `{ low: 2, high: 3 }`, `'cups'` | `2–3 cups`  |
 * | `absent` | `—`, `'pinch'`                | `pinch`     |
 *
 * ⛔ An ABSENT quantity renders NO number — not `0`, not `1` (R40). "Butter the size of an egg" states no
 * amount, and printing one would put a figure in front of a cook that their recipe never contained. With no
 * unit either, the result is the empty string; a caller composing `"{quantity} {name}"` must trim.
 *
 * @param quantity - The ingredient quantity value object.
 * @param locale - The active BCP-47 locale.
 * @param unit - The optional unit of measure. An empty string is treated as absent.
 * @returns The formatted "quantity unit" string (either part alone when the other is absent; `''` when both
 *   are).
 */
export const formatQuantity = (quantity: IngredientQuantity, locale: Locale, unit?: string): string => {
    const format = (value: number): string => new Intl.NumberFormat(locale).format(value);
    const formattedQuantity =
        quantity.kind === 'exact'
            ? format(quantity.value)
            : quantity.kind === 'range'
              ? `${format(quantity.low)}${RANGE_SEPARATOR}${format(quantity.high)}`
              : '';
    const hasUnit = unit !== undefined && unit.length > 0;

    if (formattedQuantity.length === 0) {
        return hasUnit ? unit : '';
    }

    return hasUnit ? `${formattedQuantity} ${unit}` : formattedQuantity;
};

/**
 * A detail row in one string — `2 tbsp Olive oil`, `2 tbsp Private ingredient` — the row checkbox's accessible
 * name. Pure.
 *
 * @param line - The line as the detail read returns it, or an editor draft line with its quantity parsed
 *   (`draftQuantity`), which the editor row's glyph names itself with (namelessLineCopy §7, 2.5.3).
 * @param locale - The active BCP-47 locale.
 * @param labels - The stand-ins for a line with no name.
 * @returns The quantity, unit and name, trimmed so an absent amount (R40) leaves no leading space.
 */
export const lineSummary = (
    line: Pick<RecipeIngredientView, 'quantity' | 'unit'> & NameableLine,
    locale: Locale,
    labels: IngredientLineNameMessages,
): string => `${formatQuantity(line.quantity, locale, line.unit)} ${lineDisplayName(line, labels)}`.trim();

/**
 * The read view's ingredient checkbox name (`docs/design/ingredientSpecialization.md` §S5): {@link lineSummary} on a
 * root-bound line, and on a variant-bound line the same with every part after the name, comma-joined for a screen
 * reader (R27). Pure.
 *
 * @param line - The line as the detail read returns it.
 * @param locale - The active BCP-47 locale.
 * @param labels - The stand-ins for a line with no name.
 * @param withDetails - The `checkLabelWithDetails` template (`{quantity}`, `{food}`, `{parts}`).
 * @returns The name, trimmed so an absent amount (R40) leaves no leading space.
 */
export const ingredientCheckLabel = (
    line: RecipeIngredientView,
    locale: Locale,
    labels: IngredientLineNameMessages,
    withDetails: string,
): string => {
    const parts = variantPartTexts(line.variant?.parts);

    if (parts === undefined) {
        return lineSummary(line, locale, labels);
    }

    return fillTemplate(withDetails, {
        quantity: formatQuantity(line.quantity, locale, line.unit),
        food: lineDisplayName(line, labels),
        parts: spokenVariantParts(parts),
    }).trim();
};

/**
 * Format one SNAPSHOT ingredient line as a reader sees it — `2 cups Flour (sifted), finely chopped`.
 *
 * DESIGN PATTERN: one authoritative formatting per piece of knowledge, the same rule {@link formatQuantity}
 * exists for. ⚠️ EXTRACTED, not added: `versions/model.ts`'s version-preview projection and
 * `versions/conflictDiff.ts`'s merge-row formatter were BYTE-IDENTICAL copies of this function, so a field
 * added to one and forgotten in the other would have rendered a version's history and its conflict merge
 * differently for the same line. Both now call this.
 *
 * ⛔ `displayText` is PARENTHESISED beside the name and `preparation` is a trailing CLAUSE, and the two are
 * not interchangeable. `displayText` is an author-chosen DISPLAY override — parenthesising it beside the
 * name is exactly what it is for — while U26's rule is that a preparation is NEVER concatenated into the
 * food's name, because a name carrying one matches no catalog row. The name variable below is built from
 * the frozen name alone plus that override; the preparation is appended after it.
 *
 * ⚠️ Rendering the preparation at all is a CORRECTNESS requirement rather than polish. `diffSnapshots`
 * counts a preparation-only edit as `modified`, so a formatter that omitted it would show two IDENTICAL
 * lines beside a history entry claiming one changed — and, on the conflict merge, would ask a cook to
 * CHOOSE between two strings that read the same.
 *
 * ⚠️ The comma is PUNCTUATION, not copy — the same call the ingredient row makes for the EN DASH between
 * two quantity bounds. It carries no meaning to translate; the words on either side are the cook's own.
 *
 * ⛔ A version that froze no name shows the stand-in, never `undefined` (plan 002 R52).
 *
 * @param ingredient - The snapshot ingredient line.
 * @param locale - The active BCP-47 locale.
 * @param labels - The stand-ins for a line with no name.
 * @returns The formatted line. Pure.
 */
export const formatIngredientLine = (
    ingredient: RecipeIngredient,
    locale: Locale,
    labels: IngredientLineNameMessages,
): string => {
    const frozenName = snapshotLineName(ingredient, labels);
    const name = ingredient.displayText !== undefined ? `${frozenName} (${ingredient.displayText})` : frozenName;
    const described = ingredient.preparation === undefined ? name : `${name}, ${ingredient.preparation}`;
    // `.trim()`: an ABSENT quantity with no unit formats to `''` (R40), which would otherwise leave the line
    // starting with a space.
    const line = `${formatQuantity(ingredient.quantity, locale, ingredient.unit)} ${described}`.trim();

    // ⛔ THE SECTION, for the SAME reason as the preparation and it must not be treated as the lesser case.
    // `ingredientContentChanged` counts a section-only edit as `modified` on exactly the same footing, so a
    // formatter that rendered the preparation and omitted the section would still show two IDENTICAL lines
    // beside a history entry claiming one changed — and, on the conflict merge, would ask a cook to CHOOSE
    // between two strings that read the same. Rendering one and not the other is the inconsistency the
    // preparation argument itself rules out.
    //
    // ⚠️ The brackets are PUNCTUATION, not copy, and the label inside them is the cook's own free text.
    return ingredient.groupLabel === undefined ? line : `${line} [${ingredient.groupLabel}]`;
};

/** Which bound a collapsed range contributed from — DERIVED from the model, never re-declared. */
type RangeDerivedBound = NonNullable<RecipeNutrition['rangeDerivedBound']>;

/**
 * The localized sentence for each bound a nutrition figure can have been taken from.
 *
 * A `Record` over the union rather than two loose strings: a third bound added to the model is a COMPILE
 * error at every call site instead of a caveat that silently renders nothing. Each entry is a WHOLE
 * sentence for the same reason `nutrition/messages.ts` gives — a figure with a qualifier concatenated on
 * reads as one sentence in English and as nonsense in a language that inflects or fronts the qualifier.
 */
export type RangeDerivedNotices = Readonly<Record<RangeDerivedBound, string>>;

/**
 * The R38 disclosure for a per-serving figure computed from ONE bound of a stated range. Pure — the single
 * selector both platforms and both surfaces (the detail read view and the editor's running total) use.
 *
 * ⛔ Load-bearing honesty, not decoration. A total computed from `2 cups` when the line reads `2 to 3 cups`
 * is up to a third under and is otherwise indistinguishable from an exact one. The model makes the FIELD's
 * presence the disclosure (there is no "not applicable" value), and this function keeps that property: no
 * collapsed range yields `undefined`, and a caller renders nothing rather than a reassuring sentence.
 *
 * The bound is READ, never assumed. Today's policy only ever collapses to `low`, so hard-coding the copy
 * would pass every test and start lying the day the policy changes server-side.
 *
 * @param nutrition - The per-serving figures, carrying the bound marker when a range was collapsed.
 * @param notices - The localized sentence for each bound.
 * @returns The disclosure to render, or `undefined` when no range was collapsed.
 */
export const rangeDerivedNotice = (nutrition: RecipeNutrition, notices: RangeDerivedNotices): string | undefined =>
    nutrition.rangeDerivedBound === undefined ? undefined : notices[nutrition.rangeDerivedBound];

/**
 * The detail's stale-data disclosure (KTD-3b — serve stale, MARKED). Pure — the one selector both platforms use.
 *
 * The server decides staleness per line, over the lines that actually counted; this only renders what it was
 * told. A fresh reading yields `undefined` rather than a reassuring sentence, so a caller renders nothing.
 *
 * @param nutrition - The detail's per-serving figures, carrying their freshness.
 * @param notice - The localized disclosure.
 * @returns The disclosure to render, or `undefined` when the figures were fetched for this read.
 */
export const staleNutritionNotice = (
    nutrition: Pick<RecipeDetailNutrition, 'freshness'>,
    notice: string,
): string | undefined => (nutrition.freshness === 'stale' ? notice : undefined);

/**
 * Whether the U11 verification gate CONTRADICTED this line, so its catalog nutrition was withheld from the
 * recipe's figure (plan U14 / R15). Pure.
 *
 * ⛔ ONLY `NEEDS_REVIEW`. Every other status — including the terminal `NOT_FOUND`/`FAILED` — is a fact about
 * the FOOD LINK, not a doubt about our reading of the cook's source, and an ABSENT status means the gate has
 * not judged the line at all. Migration 0023 is explicit that absence means PUBLISH: the gate runs off a
 * queue, so a line publishes between save and verification whatever the verdict table says.
 *
 * @param line - One recipe ingredient line as the detail read returns it.
 * @returns `true` only for a line the gate contradicted.
 */
export const isLineNeedsReview = (line: RecipeIngredientView): boolean =>
    line.resolutionStatus === FoodResolutionStatus.NEEDS_REVIEW;

/**
 * How many of a recipe's lines the gate contradicted. Pure.
 *
 * @param ingredients - The recipe's ingredient lines.
 * @returns The count of doubted lines.
 */
export const needsReviewCount = (ingredients: readonly RecipeIngredientView[]): number =>
    ingredients.filter(isLineNeedsReview).length;

/** The two localized sentences {@link needsReviewNotice} chooses between. */
export interface NeedsReviewNotices {
    /** The sentence for exactly one doubted line. */
    readonly needsReviewNoticeOne: string;
    /** The template for two or more (contains `{count}`). */
    readonly needsReviewNoticeMany: string;
}

/**
 * The recipe-level disclosure for a figure the gate withheld, or `undefined` when nothing was doubted. Pure.
 *
 * ⛔ ITS OWN SENTENCE, not the partial-nutrition caveat. "Some items aren't counted yet" says the catalog had
 * nothing; this says the catalog HAD the figure and we declined to publish it because a check against the
 * cook's own wording disagreed with our match. The two have different fixes — wait, versus correct the
 * match — so collapsing them tells a cook nothing actionable. This is the client half of the wire's
 * `unaccounted{verification_disagreement}`, which exists for the same reason.
 *
 * ⚠️ Singular and plural are two STRINGS rather than one template with a number in it: English
 * pluralization is not a substitution, and a locale that inflects differently changes the catalogue rather
 * than this function.
 *
 * @param ingredients - The recipe's ingredient lines.
 * @param notices - The localized copy for the active locale.
 * @returns The disclosure to render, or `undefined` when no line was doubted.
 */
export const needsReviewNotice = (
    ingredients: readonly RecipeIngredientView[],
    notices: NeedsReviewNotices,
): string | undefined => {
    const count = needsReviewCount(ingredients);

    if (count === 0) {
        return undefined;
    }

    return count === 1 ? notices.needsReviewNoticeOne : fillTemplate(notices.needsReviewNoticeMany, { count });
};

/**
 * Whether the gate marked this line AMBIGUOUS (plan U13, D7/R9) — the pick affordance's key. Pure.
 *
 * ⛔ ONLY `AMBIGUOUS`. Needs-review is a CONTRADICTION with the figure withheld; pending is a check in
 * flight; this is an ABSTENTION over materially-different candidates whose figure still counts (R23) —
 * three different affordances, three predicates.
 *
 * @param line - One recipe ingredient line as the detail read returns it.
 * @returns `true` only for a gate-ambiguous line.
 */
export const isLineAmbiguous = (line: RecipeIngredientView): boolean =>
    line.resolutionStatus === FoodResolutionStatus.AMBIGUOUS;

/**
 * Whether this line's food was WITHDRAWN by its author (owner rulings 3 + 4, 2026-09-07). Pure.
 *
 * ⛔ ONLY `FOOD_REMOVED`, and the two neighbours it must never absorb are the point of the predicate.
 * `RESOLVED_UNAVAILABLE` says the food EXISTS and is not served to THIS viewer — a privacy answer, true of
 * one reader and false of another, with nothing wrong. `NOT_FOUND` says no wired source ever had it. This
 * says we had it and its author took it away: permanent and true for everyone. The line keeps its name only while
 * food can still read the withdrawn food (plan 002 R9).
 *
 * @param line - One recipe ingredient line as the detail read returns it.
 * @returns `true` only for a line whose food was withdrawn.
 */
export const isLineFoodRemoved = (line: RecipeIngredientView): boolean =>
    line.resolutionStatus === FoodResolutionStatus.FOOD_REMOVED;

/*
 * ⚠️ `isUserEntered` and `FOOD_REMOVED` CANNOT co-occur, which is why no leaf handles the two badges
 * together. A user-entered line is bound to a declared name, not to a food (ADR-0045), so food is never asked
 * about it and `foodPresenceStatus` can never reach `FOOD_REMOVED`. Recorded here because the layout
 * consequence is real: that pair would be the widest possible ingredient row, and it is unreachable rather
 * than untested.
 */

/**
 * How many of a recipe's lines lost their food. Pure.
 *
 * @param ingredients - The recipe's ingredient lines.
 * @returns The count of removed lines.
 */
export const foodRemovedCount = (ingredients: readonly RecipeIngredientView[]): number =>
    ingredients.filter(isLineFoodRemoved).length;

/**
 * Whether food could not be asked about this line on this read (plan 002 R2, R36). Pure.
 *
 * ⛔ ONLY `FOOD_UNREACHABLE`. `FOOD_REMOVED` is a fact food reported; this is the absence of any report, and it is
 * transient — the next read may name the line.
 *
 * @param line - One recipe ingredient line as the detail read returns it.
 * @returns `true` only for a line food could not be asked about.
 */
export const isLineUnreachable = (line: RecipeIngredientView): boolean =>
    line.resolutionStatus === FoodResolutionStatus.FOOD_UNREACHABLE;

/**
 * How many of a recipe's lines food could not be asked about. Pure.
 *
 * @param ingredients - The recipe's ingredient lines.
 * @returns The count of unreachable lines.
 */
export const unreachableLineCount = (ingredients: readonly RecipeIngredientView[]): number =>
    ingredients.filter(isLineUnreachable).length;

/**
 * Whether a retry from the unreachable notice RECOVERED: it settled with a recipe whose every line food answered for.
 * The app passes this to that notice's `useRefreshNotice` as `recovered`, so its `recoveries` counts only retries
 * that loaded every name — the one outcome that removes the button the cook pressed. A retry that named only some
 * lines leaves the button, and focus, where they are. Pure.
 *
 * @param recipe - The recipe the retry settled with, if any.
 * @returns `true` when there is a recipe and no line of it is unreachable.
 */
export const isUnreachableRecovery = (recipe: RecipeDetail | undefined): boolean =>
    recipe !== undefined && unreachableLineCount(recipe.ingredients) === 0;

/** The two localized sentences {@link unreachableNotice} chooses between. */
export interface UnreachableNotices {
    /** The sentence for exactly one unreachable line. */
    readonly unreachableNoticeOne: string;
    /** The template for two or more (contains `{count}`). */
    readonly unreachableNoticeMany: string;
}

/**
 * The recipe-level notice for lines food could not be asked about, or `undefined` when food answered for every
 * line. ONE notice per recipe, never one per line: food is asked about every line in one batch, so one failure
 * usually hits several lines. Pure.
 *
 * @param ingredients - The recipe's ingredient lines.
 * @param notices - The localized copy for the active locale.
 * @returns The notice, or `undefined`.
 */
export const unreachableNotice = (
    ingredients: readonly RecipeIngredientView[],
    notices: UnreachableNotices,
): string | undefined => {
    const count = unreachableLineCount(ingredients);

    if (count === 0) {
        return undefined;
    }

    return count === 1 ? notices.unreachableNoticeOne : fillTemplate(notices.unreachableNoticeMany, { count });
};

/** Which refresh notice speaks on the detail page, and whether the Ingredients heading says the lines recovered. */
export interface DetailNoticeState {
    /** The recipe-level notice for lines food could not be asked about, or `undefined` when every line is named. */
    readonly unreachable: string | undefined;
    /**
     * Whether the page-level notice shows its failure. ⛔ It yields while a line is unreachable: both notices retry
     * the same read, and one cause gets one Try again, so a retry pressed on the lines that fails at transport keeps
     * its own button and focus.
     */
    readonly pageRefreshFailed: boolean;
    /** Whether the Ingredients heading says the lines recovered: a counted retry loaded every name. */
    readonly saysRecovered: boolean;
}

/**
 * The detail page's notice state, for the web and native bodies alike. Pure.
 *
 * @param ingredients - The recipe's STORED ingredient lines.
 * @param notices - The localized copy for the active locale.
 * @param refreshNotice - The page-level refresh notice, when the page shows one.
 * @param unreachableRetry - The unreachable lines' own retry. Its `recoveries` counts only retries that named every
 *   line, so it never moves on a partial recovery or a background refetch.
 * @returns Which notice speaks, and whether the recovery is said.
 */
export const detailNoticeState = (
    ingredients: readonly RecipeIngredientView[],
    notices: UnreachableNotices,
    refreshNotice: RefreshNoticeControl | undefined,
    unreachableRetry: RetryControl,
): DetailNoticeState => {
    const unreachable = unreachableNotice(ingredients, notices);

    return {
        unreachable,
        pageRefreshFailed: refreshNotice?.failed === true && unreachable === undefined,
        saysRecovered: unreachableRetry.recoveries > 0 && unreachable === undefined,
    };
};

/**
 * Whether EVERY line lost its food — the case that gets its own copy and suppresses the per-line badges.
 * Pure.
 *
 * ⛔ FALSE for an empty list. `[].every(…)` is vacuously `true`, which would announce "every ingredient
 * here was removed" on a recipe with no ingredients at all — a claim about a removal that never happened.
 * The length check is the whole reason this is a function rather than an inline `.every`.
 *
 * @param ingredients - The recipe's ingredient lines.
 * @returns Whether there is at least one line and all of them were removed.
 */
export const allLinesFoodRemoved = (ingredients: readonly RecipeIngredientView[]): boolean =>
    ingredients.length > 0 && ingredients.every(isLineFoodRemoved);

/** The three localized sentences {@link removedFoodNotice} chooses between. */
export interface RemovedFoodNotices {
    /** The sentence for exactly one removed line; contains `{name}`. */
    readonly removedFoodNoticeOne: string;
    /** The sentence for exactly one removed line that has no name. */
    readonly removedFoodNoticeOneUnnamed: string;
    /** The sentence for two or more; contains `{count}`. */
    readonly removedFoodNoticeMany: string;
    /** The sentence when every line was removed. */
    readonly removedFoodNoticeAll: string;
}

/**
 * The recipe-level disclosure for lines whose food was withdrawn, or `undefined` when none were. Pure.
 *
 * ⛔ THREE strings, and the third is not the second with a bigger number. The plural copy points at the
 * per-line badges; those are SUPPRESSED when every line is removed (a badge on every row is wallpaper, not
 * signal), so reusing it there would point a cook at nothing. Singular and plural are separate for the
 * reason every count string in this package is: English pluralization is not a substitution.
 *
 * ⚠️ The SINGULAR string wins over the all-lines one on a one-ingredient recipe, even though such a recipe
 * arithmetically satisfies both. Naming the ingredient is a complete answer that needs no scanning, the
 * all-lines copy cannot name it, and the badge-suppression argument does not apply to a single row.
 *
 * ⛔ It names `line.name` — the name the read gave THIS viewer — and never anything else. The server leaves out the
 * name of a food the viewer may not see (plan 002 R9), so naming the line cannot leak a private food's name. A
 * line with no name gets its own sentence rather than an empty quotation.
 *
 * @param ingredients - The recipe's ingredient lines.
 * @param notices - The localized copy for the active locale.
 * @returns The disclosure to render, or `undefined` when no line lost its food.
 */
export const removedFoodNotice = (
    ingredients: readonly RecipeIngredientView[],
    notices: RemovedFoodNotices,
): string | undefined => {
    const removed = ingredients.filter(isLineFoodRemoved);

    if (removed.length === 0) {
        return undefined;
    }

    if (removed.length === 1) {
        const name = removed[0]?.name;

        // A gone food can take the line's name with it (plan 002 R9), and quoting nothing reads `“” was removed`.
        return name === undefined || name.length === 0
            ? notices.removedFoodNoticeOneUnnamed
            : fillTemplate(notices.removedFoodNoticeOne, { name });
    }

    return allLinesFoodRemoved(ingredients)
        ? notices.removedFoodNoticeAll
        : fillTemplate(notices.removedFoodNoticeMany, { count: removed.length });
};

/** One row of the review surface: one AMBIGUOUS line, and where the recipe stores it. */
export interface AmbiguityReviewLine {
    /** The line's 0-based position in the recipe's stored order: the address its rebind is sent to. */
    readonly position: number;
    /** The line's name, which the row searches. */
    readonly name: string;
    /** The line as the detail read returns it. */
    readonly line: RecipeIngredientView;
}

/**
 * The review surface's rows: one per AMBIGUOUS line, in stored order, each at its stored position.
 *
 * ⛔ One row per LINE, never per phrase: one pick fixes one line (owner ruling 2026-10-02, "Fix one line at a time"),
 * so two lines with the same name are two rows. The position counts every line, ambiguous or not, because the rebind
 * addresses a line by its place in the recipe. Pure.
 *
 * @param ingredients - The recipe's STORED lines (never the scaled projection).
 * @returns The review rows.
 */
export const ambiguityReviewLines = (ingredients: readonly RecipeIngredientView[]): AmbiguityReviewLine[] =>
    ingredients.flatMap((line, position) =>
        // A line with no name (plan 002 R9) has nothing to search, so it forms no row.
        isLineAmbiguous(line) && line.name !== undefined ? [{ position, name: line.name, line }] : [],
    );

/**
 * How many taken picks have had their row leave the review: the signal that moves focus off a row that has gone.
 *
 * ⚠️ A taken pick's row leaves only once the detail read shows its line resolved, and that can render after the pick
 * reports success. Counting the pick before its row has gone would move focus while the pressed candidate still held
 * it, and then let it drop to the page when the row went (WCAG 2.2 SC 2.4.3). While the last taken pick's line stays
 * listed (a food the line already had), that pick is not counted, because no control went. Pure.
 *
 * @param saves - How many picks the recipe has taken (`AmbiguityPickController.saves`).
 * @param takenAt - The stored position of the last taken pick's line, if the last pick was taken.
 * @param lines - The review's rows now.
 * @returns The count.
 */
export const reviewRowsGone = (
    saves: number,
    takenAt: number | undefined,
    lines: readonly AmbiguityReviewLine[],
): number => (takenAt !== undefined && lines.some((review) => review.position === takenAt) ? saves - 1 : saves);

/**
 * What a review pick re-points its line to: a root of our catalog, by id, or a remote food, by the reference food issued
 * (ADR-0055 point 10), which the pick adopts first. A correction binds a food, never a variant.
 */
export type ReviewPick = { readonly kind: 'catalogFood'; readonly foodId: string } | RemoteFoodPick;

/** A food the ambiguity review offers for a line. It shows no variant parts, so it binds no variant. */
export interface ReviewCandidate {
    /** Unique in the shortlist: the group and the id, or the source and the reference. */
    readonly key: string;
    readonly name: string;
    /** Its name when it says more than the visible one: a remote food's names its source (P5, 2.5.3). */
    readonly accessibleName: string | undefined;
    readonly pick: ReviewPick;
}

/** A run of candidates: our database's, unlabelled, or one remote source's, under `From {source}` (P12). */
export interface ReviewGroup {
    readonly key: string;
    readonly label: string | undefined;
    readonly candidates: readonly ReviewCandidate[];
}

/** What one review row offers for its line. */
export type ReviewShortlist =
    /** The database part has not arrived. */
    | { readonly kind: 'loading' }
    /** The search is held offline; it resumes by itself (P6). */
    | { readonly kind: 'offline' }
    /** Nothing arrived, or every part failed (P6): the row says so and offers Try again (P12 defect (b)). */
    | { readonly kind: 'failed' }
    /** Every part answered with no food: nothing to choose from (P12). */
    | { readonly kind: 'empty' }
    /** The foods found, our database's first and each source's after, and what the list could not show. */
    | {
          readonly kind: 'listed';
          readonly groups: readonly ReviewGroup[];
          readonly database: DatabasePart;
          readonly remote: readonly RemotePart[];
          readonly progress: AnswerProgress;
      };

/**
 * A review row's shortlist, from the same progressive answer the editor's list reads (`docs/design/
 * rowEditorOpenDecisions.md`, S7 list contract P12): our database's foods first, then each source's under
 * `From {source}`, added at the end so nothing shown moves (P2). A root that matched a variant is offered as the root,
 * because the candidate draws no dotted line (`docs/design/ingredientSpecialization.md` §S1). Pure.
 *
 * @param view - The line's food list.
 * @param naming - How the review names a source (P5).
 * @param copy - The localised copy.
 * @returns The shortlist.
 */
export const reviewShortlistOf = (
    view: EntrySearchView,
    naming: Pick<SourceNaming, 'sourceName'>,
    copy: { readonly remote: Pick<IngredientRemoteSearchMessages, 'groupHeading' | 'hitName' | 'sourceUnnamed'> },
): ReviewShortlist => {
    switch (view.kind) {
        case 'idle':
        case 'tooShort':
            return { kind: 'empty' };
        case 'searching':
            return { kind: 'loading' };
        case 'offline':
            return { kind: 'offline' };
        case 'failed':
            return { kind: 'failed' };

        case 'served': {
            const database: ReviewCandidate[] = servedFoodsOf(view).map((food) => ({
                key: `${food.group}:${food.hit.id}`,
                name: food.hit.name,
                accessibleName: undefined,
                pick: { kind: 'catalogFood', foodId: food.hit.id },
            }));
            const groups: ReviewGroup[] =
                database.length === 0 ? [] : [{ key: 'database', label: undefined, candidates: database }];

            for (const part of view.remote) {
                if (part.kind === 'answered' && part.foods.length > 0) {
                    const source = sourceDisplayName(part.source, naming, copy);

                    groups.push({
                        key: `remote:${part.source}`,
                        label: fillTemplate(copy.remote.groupHeading, { source }),
                        candidates: part.foods.map((food) => ({
                            key: `remote:${part.source}:${food.hit.reference}`,
                            name: food.hit.name,
                            accessibleName: fillTemplate(copy.remote.hitName, { name: food.hit.name, source }),
                            pick: remotePickOf(food),
                        })),
                    });
                }
            }

            const databaseAnswered =
                view.database.authored.kind === 'answered' && view.database.catalog.kind === 'answered';
            const ended = view.progress !== 'running';

            if (
                ended &&
                !databaseAnswered &&
                view.database.authored.kind === 'unavailable' &&
                view.database.catalog.kind === 'unavailable' &&
                view.remote.every((part) => part.kind !== 'answered')
            ) {
                return { kind: 'failed' };
            }

            // Only an answer from every part, completed, may say there is nothing: anything else has a note to say.
            if (
                view.progress === 'complete' &&
                groups.length === 0 &&
                databaseAnswered &&
                view.remote.every((part) => part.kind === 'answered')
            ) {
                return { kind: 'empty' };
            }

            return { kind: 'listed', groups, database: view.database, remote: view.remote, progress: view.progress };
        }
    }
};

/** The sentences a review row's status line chooses between, already localised. */
export interface ReviewShortlistCopy extends ProgressiveNotesCopy {
    /** `ambiguousReviewLoading`: the whole answer's line, so the row speaks once, at its end (P7, per row). */
    readonly loading: string;
    readonly offline: string;
    readonly form: ProgressiveNotesCopy['form'] & Pick<RecipeFormMessages, 'candidatesLoadFailed' | 'candidatesEmpty'>;
    readonly remote: ProgressiveNotesCopy['remote'] & Pick<IngredientRemoteSearchMessages, 'incomplete'>;
}

/**
 * What a review row's status line says (P12): the same line while the answer runs, then at its end what the list could
 * not show, that nothing was found, or that the search failed. The line sits after the chips and is polite. Pure.
 *
 * @param shortlist - The row's shortlist.
 * @param naming - How the review names a source and says a time and a list.
 * @param copy - The localised sentences.
 * @returns The sentence, or `''` when there is nothing to say.
 */
export const reviewShortlistStatus = (
    shortlist: ReviewShortlist,
    naming: SourceNaming,
    copy: ReviewShortlistCopy,
): string => {
    switch (shortlist.kind) {
        case 'loading':
            return copy.loading;
        case 'offline':
            return copy.offline;
        case 'failed':
            return copy.form.candidatesLoadFailed;
        case 'empty':
            return copy.form.candidatesEmpty;

        case 'listed': {
            if (shortlist.progress === 'running') {
                return copy.loading;
            }

            const unsearched = unsearchedSentenceOf(shortlist.database, copy);

            return [
                ...(unsearched === undefined ? [] : [unsearched]),
                ...sourceNotesOf(shortlist.remote, naming, copy),
                ...(shortlist.progress === 'incomplete' ? [copy.remote.incomplete] : []),
            ].join(' ');
        }
    }
};

/** The two localized sentences {@link ambiguousNotice} chooses between. */
export interface AmbiguousNotices {
    /** The entry sentence for exactly one ambiguous line. */
    readonly ambiguousNoticeOne: string;
    /** The template for two or more (contains `{count}`). */
    readonly ambiguousNoticeMany: string;
}

/**
 * The recipe-level ENTRY into the batched review surface, or `undefined` when nothing is ambiguous. The
 * count is LINES (what a cook sees), not groups. Same singular/plural split as {@link needsReviewNotice},
 * for the same localization reason. Pure.
 *
 * @param ingredients - The recipe's ingredient lines.
 * @param notices - The localized copy for the active locale.
 * @returns The entry sentence, or `undefined`.
 */
export const ambiguousNotice = (
    ingredients: readonly RecipeIngredientView[],
    notices: AmbiguousNotices,
): string | undefined => {
    const count = ingredients.filter(isLineAmbiguous).length;

    if (count === 0) {
        return undefined;
    }

    return count === 1 ? notices.ambiguousNoticeOne : fillTemplate(notices.ambiguousNoticeMany, { count });
};

/**
 * The one-time CLONE banner's sentence, or `undefined` when the response carried no count — which is every
 * non-clone read, and every clone whose lines this viewer can all see. Pure.
 *
 * The count is of lines KEPT bound to a food this viewer may not see (plan 002). Singular and plural are separate
 * strings for the reason every count string in this package is: English pluralization is not a substitution.
 *
 * @param clonePrivateFoodLineCount - The clone response's count, if present.
 * @param notices - The localized banner sentences.
 * @returns The banner sentence, or `undefined`.
 */
export const clonePrivateFoodsBannerText = (
    clonePrivateFoodLineCount: number | undefined,
    notices: { readonly clonePrivateFoodsBannerOne: string; readonly clonePrivateFoodsBannerMany: string },
): string | undefined => {
    if (clonePrivateFoodLineCount === undefined || clonePrivateFoodLineCount === 0) {
        return undefined;
    }

    return clonePrivateFoodLineCount === 1
        ? notices.clonePrivateFoodsBannerOne
        : fillTemplate(notices.clonePrivateFoodsBannerMany, { count: clonePrivateFoodLineCount });
};

/**
 * Props for the recipe-detail HERO cover, shared by the web (`RecipeHero.tsx`) and native
 * (`RecipeHero.native.tsx`) leaves so the two cannot drift on the contract (§14.4).
 */
export interface RecipeHeroProps {
    /** The recipe title — the photos' alt text and the carousel's names are built from it. */
    readonly title: string;
    /**
     * The recipe's photos, in display order. The first is the cover (the service's rule, on every read path), so the
     * hero is the carousel itself and shows the cover once (F2). EMPTY → the deliberate no-photo placeholder.
     *
     * Deliberately NOT `coverPhotoUrl`: that is a small thumbnail of `photos[0]`, made for the card, and reading it here
     * as well is how the cover came to be painted twice.
     */
    readonly photos: readonly RecipePhoto[];
}

/**
 * Props for the recipe-detail view — a presentational render of an already-loaded {@link RecipeDetail}.
 *
 * The cooking-progress sets + toggle callbacks and the tag-filter callback are OPTIONAL: the view is a pure
 * `props → JSX` render, and the interaction/state lives in the orchestration container (which passes them
 * from `useCookingProgress` + router navigation). Rendered standalone (e.g. a story or a narrow test) the
 * checkboxes read unchecked and the tag chips are inert — no crashes, no hidden state.
 */
export interface RecipeDetailViewProps {
    readonly recipe: RecipeDetail;
    /** Ingredient ids the cook has checked off (D5). Absent → all unchecked. */
    readonly checkedIngredients?: ReadonlySet<string>;
    /** Toggle an ingredient's gathered state (D5). */
    readonly onToggleIngredient?: (ingredientId: string) => void;
    /** 1-based step numbers the cook has marked done (D4). Absent → all unchecked. */
    readonly checkedSteps?: ReadonlySet<number>;
    /** Toggle a step's completed state (D4). */
    readonly onToggleStep?: (stepNumber: number) => void;
    /** Navigate to the visibility-scoped search filtered by `tag` (D6). */
    readonly onFilterByTag?: (tag: string) => void;
    /**
     * Caller-supplied content grouped into the ONE footer row alongside the version + visibility badges (C3
     * wireframe parity) — e.g. the clone action for a non-owner viewer. Absent renders no slot (e.g. the
     * owner viewing their own recipe, where the shared `canClone` gate excludes a clone control entirely).
     */
    readonly footerActions?: ReactNode;
    /**
     * Caller-supplied owner controls rendered in the detail's TITLE BAND, beside the recipe name — the C4
     * wireframe's `[Edit] [More]` pair. Absent renders no slot (a non-owner viewer has no controls here).
     *
     * ⛔ THIS IS A SLOT, NOT A `canEdit` FLAG, for the reason {@link footerActions} is one: the ownership
     * gate, the routes, and the overflow menu's contents are all orchestration concerns, and the body stays
     * a pure `props → JSX` render that knows only WHERE the controls go. A boolean would drag the router,
     * the locale and the premium tier into a presentational leaf.
     *
     * ⛔ THE LEAF OWNS THE ROW, the caller supplies BARE CHILDREN. Direction, gap, alignment and `shrink-0`
     * are the leaf's (`RecipeDetailBody.tsx` / `.native.tsx`), because the title band's layout is the thing
     * the two platforms must agree on. A caller that wraps its controls in a second flex row writes that
     * layout knowledge down twice and the copies drift — which had already happened between the two
     * platforms on the first draft of this slot.
     *
     * ⚠️ A caller passes `undefined` for "no controls", never `null` or `false`. The leaf guards on
     * `!== undefined` (the house form for an optional `ReactNode` slot); a `null` would render an empty row
     * that still consumes the band's gap.
     *
     * ⚠️ The DELETE CONFIRMATION DIALOG does not belong in here. Both containers keep it a SIBLING so it
     * survives the overflow menu closing (including the menu's own outside-click); nesting it inside the
     * title band would couple its lifetime to the menu's and put a dialog inside a `<header>`.
     */
    readonly headerActions?: ReactNode;
    /** Optional notice for a failed refresh of the recipe on screen — both platforms. Absent ⇒ no notice. */
    readonly refreshNotice?: RefreshNoticeControl;
    /**
     * The retry behind the notice for lines food could not be asked about (plan 002 R2): a SECOND
     * `useRefreshNotice` over the same query, given {@link isUnreachableRecovery} as its `recovered` test, so its
     * `recoveries` counts only retries that loaded every name and moves focus to the Ingredients heading rather
     * than the title. Its failure is the unreachable line count, never `isRefetchError`, so it carries no `failed`.
     */
    readonly unreachableRetry: RetryControl;
    /**
     * Web: the Data sources page's address, which the web app's router owns (`dataSourcesHref` in `@commise/web`), as
     * it owns the settings link's. The nutrition note's link goes there, and with no address the link is not drawn,
     * so the web host always passes it (`RecipeDetailContainer`; `recipeCrud.spec.ts` asserts the link). Native
     * ignores it: its shell opens the Data sources sheet (`RecipeDetailBodyNativeProps.onOpenDataSources`). The
     * list tabs' `href` follows the same split (`RecipeListTabControl`).
     */
    readonly dataSourcesHref?: string;
    /**
     * Whether the viewer owns this recipe (`isOwner`, which the container already evaluates for its owner controls).
     * Only the owner is offered the ambiguity review's picks: a pick re-points a line through the rebind command, which
     * answers `NOT_OWNER` to anyone else. Absent reads as not the owner, so nothing that could only fail is offered.
     */
    readonly viewerIsOwner?: boolean;
}

/**
 * Props for the PURE detail body — the whole `RecipeDetailView` contract plus the serving scale it renders
 * at. Split out so the body stays `props → JSX` while `RecipeDetailView` itself is a thin orchestration
 * shell that binds the session serving-scale store and computes the scaled projection.
 *
 * The scale is deliberately NOT on {@link RecipeDetailViewProps}: it is not something an app can forget to
 * wire, because there is nothing for an app to wire. That is the structural answer to the failure this
 * feature was added to fix — a capability that reaches the screen only if a container remembers to pass it.
 */
export interface RecipeDetailBodyProps extends RecipeDetailViewProps {
    /** The serving count the body renders at (already clamped to the recipe's supported `servingsRange`). */
    readonly servings: number;
    /** Report a newly chosen serving count back to the shell. */
    readonly onServingsChange: (servings: number) => void;
}

/**
 * The NATIVE body's props: the shared contract plus the Data sources sheet its shell owns
 * (`docs/design/ingredientSpecialization.md` §S15, §S16). Native has no router, so the nutrition note's link opens a
 * sheet; the shell mounts it and counts its closes, and each close returns the reading cursor to the link. Required,
 * so the shell cannot leave the link inert.
 */
export interface RecipeDetailBodyNativeProps extends RecipeDetailBodyProps {
    /** Open the Data sources sheet. */
    readonly onOpenDataSources: () => void;
    /** Advances each time the sheet closes. */
    readonly dataSourcesReturnFocusSignal: number;
}

/**
 * Props for the recipe-source (provenance) line, shared by the web (`RecipeSourceLine.tsx`) and native
 * (`RecipeSourceLine.native.tsx`) leaves so the two cannot drift on the contract (§14.4).
 *
 * Both fields are UNTRUSTED and both are optional; every combination renders something defensible, and the
 * all-absent case renders nothing at all. A `sourceUrl` becomes a link only if it survives `safeHttpUrl`.
 */
export interface RecipeSourceLineProps {
    /** The recipe's original URL, as stored. Untrusted — gated by `safeHttpUrl` before it is ever linked. */
    readonly sourceUrl?: string;
    /** The author-stated provenance ("Serious Eats", "Grandma's cookbook"). */
    readonly sourceAttribution?: string;
}

/**
 * The NATIVE source line's props: the shared contract plus the injected "open a URL" adapter.
 *
 * React Native has no declarative link, so leaving the app is a platform CALL. Injecting it (defaulting to
 * `openExternalUrl`) keeps the leaf a pure `props → JSX` render and gives tests a seam that a double
 * actually crosses. The web leaf needs no equivalent — `<a href>` already is the browser's link adapter.
 */
export interface RecipeSourceLineNativeProps extends RecipeSourceLineProps {
    /** Open a VERIFIED href. Defaults to the `Linking.openURL` adapter. */
    readonly onOpen?: (href: string) => void;
}

/** The copy {@link servingsAnnouncement} fills — the detail messages' spoken-count keys. */
export interface ServingsAnnouncementCopy {
    readonly servingsValueOne: string;
    readonly servingsValueOther: string;
    readonly servingsValueAtMinimum: string;
    readonly servingsValueAtMaximum: string;
}

/**
 * What the serving stepper SAYS for a count: the number, pluralised for the locale, and at an end of the range
 * that it is the end — so a + that no longer steps explains itself. Pure; both platforms speak this one string
 * (web through a status region, native through a visually hidden `LiveRegion`), so they cannot drift.
 *
 * NOTE: like the other count labels here, every non-`one` plural category maps to `other` — enough for English.
 *
 * @param servings - The count on screen.
 * @param baseServings - The recipe's own yield, which defines the range (`servingsRange`).
 * @param copy - The spoken-count templates.
 * @param locale - The active BCP-47 locale.
 * @returns The sentence to speak.
 */
export const servingsAnnouncement = (
    servings: number,
    baseServings: number,
    copy: ServingsAnnouncementCopy,
    locale: Locale,
): string => {
    const { min, max } = servingsRange(baseServings);
    const template =
        new Intl.PluralRules(locale).select(servings) === 'one' ? copy.servingsValueOne : copy.servingsValueOther;
    const value = fillTemplate(template, { count: servings });

    if (servings >= max) {
        return fillTemplate(copy.servingsValueAtMaximum, { value });
    }

    if (servings <= min) {
        return fillTemplate(copy.servingsValueAtMinimum, { value });
    }

    return value;
};

/**
 * Props for the serving-count control, shared by the web and native leaves (§14.4).
 *
 * Controlled by construction: it owns no state and derives its own bounds from `baseServings` via
 * `servingsRange`, so it cannot offer a serving count the domain would refuse.
 */
export interface ServingScaleControlProps {
    /** The serving count currently displayed. */
    readonly servings: number;
    /** The recipe's authored serving count — the default, and what defines the selectable range. */
    readonly baseServings: number;
    /** Report a newly chosen serving count. Absent → the control renders inert rather than disappearing. */
    readonly onServingsChange?: (servings: number) => void;
}

/**
 * A step timer's visible words, said in hours and minutes ("4 h 30 min") rather than the seconds it is stored in (F1,
 * `docs/design/uiOverhaul/evaluateRecipeAndWizard.md`). One derivation for both detail leaves. Pure.
 *
 * @param seconds - The step's stored timer, if any.
 * @param template - The localized step-timer template (contains `{duration}`).
 * @param durations - The localized duration templates.
 * @returns The words to show, or `undefined` when the step has no timer.
 */
export function stepTimerLabel(
    seconds: number | undefined,
    template: string,
    durations: RecipeDurationMessages,
): string | undefined {
    const said = formatDuration(seconds, durations);

    return said === undefined ? undefined : fillTemplate(template, { duration: said });
}
