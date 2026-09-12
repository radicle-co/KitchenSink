/**
 * @module details/detailsText — the details dialog's derived text, shared by the web and native leaves (curated U14;
 * `docs/design/ingredientSpecialization.md` §S8.4, §S8.5, §S8.8, §S11).
 *
 * Every function is pure and takes its templates as data, so both platforms say the same words.
 */
import { spokenVariantParts } from '@commise/ui/variant-parts-line';

import { fillTemplate } from '../list/model.js';
import type { IngredientDetailsMessages } from '../messages.js';
import type { CurrentMark, DetailsDialogOutcome, DetailsDialogState, SettledSearch } from './detailsDialogMachine.js';
import type { VariantRow } from './groupVariants.js';

/** The templates the text needs: the dialog's own, and the product's one "N cal" template. */
export interface DetailsTextMessages {
    readonly details: IngredientDetailsMessages;
    /** `recipeNutritionMessages.calories` (`{calories} cal`), the one template for a calorie figure. */
    readonly calories: string;
}

/** A calorie figure as shown and as heard. */
export interface CaloriesLabel {
    readonly visible: string;
    readonly spoken: string;
}

/**
 * A row's calories, or the absent-value text. Never `0` for a variant that states no energy (§S8.4). Pure.
 *
 * @param calories - Calories per 100 g, or `undefined`.
 * @param locale - The viewer's locale.
 * @param messages - The templates.
 * @returns The visible and spoken text.
 */
export function caloriesLabel(
    calories: number | undefined,
    locale: string,
    messages: DetailsTextMessages,
): CaloriesLabel {
    if (calories === undefined) {
        return { visible: messages.details.caloriesAbsent, spoken: messages.details.caloriesAbsentSpoken };
    }

    const figure = fillTemplate(messages.calories, {
        calories: new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(calories),
    });

    return { visible: figure, spoken: figure };
}

/**
 * A row's accessible name: its visible parts, comma-joined, then the calories, and its group's part last (R27). It
 * starts with the visible text (SC 2.5.3). Pure.
 *
 * @param row - The row.
 * @param isCurrent - Whether it is the line's current variant.
 * @param locale - The viewer's locale.
 * @param messages - The templates.
 * @returns The name.
 */
export function variantOptionName(
    row: VariantRow,
    isCurrent: boolean,
    locale: string,
    messages: DetailsTextMessages,
): string {
    const { details } = messages;
    const tokens = {
        parts: spokenVariantParts(row.shownParts),
        calories: caloriesLabel(row.calories, locale, messages).spoken,
    };

    if (row.group === undefined) {
        return fillTemplate(isCurrent ? details.optionNameCurrent : details.optionName, tokens);
    }

    return fillTemplate(isCurrent ? details.optionNameCurrentInGroup : details.optionNameInGroup, {
        ...tokens,
        group: row.group,
    });
}

/**
 * The search count, announced after typing stops (§S8.5). Pure.
 *
 * @param shown - Rows that match.
 * @param total - Rows in the full list.
 * @param messages - The templates.
 * @returns The count text.
 */
export function searchCountText(shown: number, total: number, messages: DetailsTextMessages): string {
    const { details } = messages;

    return shown === 1
        ? fillTemplate(details.searchCountOne, { count: total })
        : fillTemplate(details.searchCountOther, { shown, count: total });
}

/**
 * What the host announces as the dialog closes (§S8.8): every part of a new variant, or the removal. A dismissal
 * writes nothing and says nothing. Pure.
 *
 * @param outcome - How the dialog ended.
 * @param messages - The templates.
 * @returns The announcement, or `undefined`.
 */
export function outcomeAnnouncement(outcome: DetailsDialogOutcome, messages: DetailsTextMessages): string | undefined {
    const { details } = messages;

    switch (outcome.kind) {
        case 'dismissed':
            return undefined;
        case 'removed':
            return details.statusRemoved;
        case 'committed':
            return fillTemplate(outcome.mode === 'add' ? details.statusAdded : details.statusChanged, {
                parts: spokenVariantParts(outcome.variant.parts.map((part) => part.text)),
            });
    }
}

/**
 * Split a template around one token, so a component (the dotted line) can stand in its place and the sentence stays
 * one template (§S11). Pure.
 *
 * @param template - The localized template.
 * @param token - The token's name, without braces.
 * @returns The text before and after the token.
 * @throws {Error} When the template has no such token: a translation that drops it would hide what it names.
 */
export function splitAtToken(template: string, token: string): readonly [string, string] {
    const marker = `{${token}}`;
    const at = template.indexOf(marker);

    if (at === -1) {
        throw new Error(`The template "${template}" has no {${token}}.`);
    }

    return [template.slice(0, at), template.slice(at + marker.length)];
}

/** The current details line: the template's text around the parts, the parts, and the whole line as heard. */
interface CurrentLineView {
    readonly before: string;
    readonly parts: readonly [string, ...string[]];
    readonly after: string;
    /** The line as a screen reader hears it, for a host `Text` that owns the label on native. */
    readonly spoken: string;
}

/** What both leaves show for a state, decided once (§S8.2, §S8.7, §S9 SC 4.1.3). */
export interface DialogView {
    /** The long list: search, a full-height sheet. */
    readonly isLong: boolean;
    /** The current variant in a list state, and whether the list shows it. */
    readonly current: CurrentMark | undefined;
    readonly currentLine: CurrentLineView | undefined;
    /** Rows in the full long list; `0` otherwise. */
    readonly total: number;
    /** The one polite region's text: loading, or the settled search (§S8.5): its count, or "no matches". */
    readonly announcement: string;
}

/**
 * What the polite region says for a settled search. Pure.
 *
 * @param search - The settled search, or `undefined` while typing or with no search.
 * @param messages - The templates.
 * @returns The text, or `''` for nothing to say.
 */
function searchAnnouncement(search: SettledSearch | undefined, messages: DetailsTextMessages): string {
    if (search === undefined) {
        return '';
    }

    return search.kind === 'noMatches'
        ? fillTemplate(messages.details.noMatches, { query: search.query, count: search.total })
        : searchCountText(search.shown, search.total, messages);
}

/**
 * Derive what the dialog shows for a state. Pure.
 *
 * @param state - The dialog's state.
 * @param announcedCount - The settled search, when there is one (`VariantDetailsDialogModel.announcedCount`).
 * @param messages - The templates.
 * @returns The view.
 */
export function dialogViewOf(
    state: DetailsDialogState,
    announcedCount: SettledSearch | undefined,
    messages: DetailsTextMessages,
): DialogView {
    const { details } = messages;
    const isLong = state.name === 'longList' || state.name === 'searching' || state.name === 'noMatches';
    const current = 'current' in state && state.name !== 'detailsNoneLeft' ? state.current : undefined;
    const currentVariant = state.name === 'detailsNoneLeft' ? state.current : current?.variant;
    const template = current?.listed === false ? details.currentRetired : details.currentLine;
    const [first, ...rest] = currentVariant?.parts.map((part) => part.text) ?? [];
    const [before, after] = splitAtToken(template, 'parts');

    return {
        isLong,
        current,
        currentLine:
            first === undefined
                ? undefined
                : {
                      before,
                      parts: [first, ...rest],
                      after,
                      spoken: fillTemplate(template, { parts: spokenVariantParts([first, ...rest]) }),
                  },
        total: isLong ? state.total : 0,
        announcement: state.name === 'loading' ? details.loading : searchAnnouncement(announcedCount, messages),
    };
}
