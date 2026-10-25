/**
 * @module @commise/features-recipes/form — what each ingredient-matching leaf shows and says, from the view shapes in
 * `pasteMatchLine.ts` (`docs/design/uiRefreshWorkshop5/redesignCanvas/ingredientMatching.md`, owner rulings
 * 2026-10-25). The web and native leaves render what this returns and decide nothing, so the two platforms cannot word
 * a state differently.
 *
 * The rulings it holds:
 *
 * - A default is tagged by its flag and NEVER chosen for the cook. The server orders the options; nothing here reorders
 *   them, so the tag follows the food wherever the server put it.
 * - Every line the cook fixes or chooses offers Search for a food first (ruling I1), then the options, then "Keep … as
 *   written" as the last row of the same list.
 * - A late review result never replaces the cook's pick: the line keeps its food and adds one sentence.
 * - Prompts for a choice are muted; only a failure is `attention` (amber).
 * - Offline, search says it needs the network rather than offering a control that cannot work, and the options already
 *   loaded can still be chosen (the spec's open question on offline matching; its boards assume yes).
 * - Every repeated action carries a name that starts with its visible words and names its line (WCAG 2.5.3, 2.4.6).
 *
 * Pure and platform-agnostic.
 *
 * @pattern Presentation Model — each line's view state derived once for both platform leaves
 * @pattern Visitor — exhaustive switches over the open need and the settled line unions
 */
import type { IconName } from '@commise/ui/icon';

import { pluralOf } from '../editor/messages.js';
import type { DraftKeep } from '../editor/saveStatus.js';
import { fillTemplate } from '../format/fillTemplate.js';
import type { RecipeFormMessages } from './messages.js';
import type { FoodChoice, OpenLine, OpenNeed, PastedLineText, SettledLine } from './pasteMatchLine.js';

/** The copy this module reads. */
type Copy = Pick<RecipeFormMessages, 'foodSearch' | 'pasteMatch'>;

/** One row of an open line's list: a food, or the last row, Keep as written. */
export type FoodChoiceRow =
    | {
          readonly kind: 'food';
          readonly id: string;
          readonly label: string;
          readonly detailParts: readonly [string, ...string[]] | undefined;
          /** The quiet Default tag, on the default food only. */
          readonly tag: string | undefined;
          /** The row's accessible name: the label, its parts, its tag, and whether it is chosen. */
          readonly name: string;
          /** The food a reopened line already holds: a check is drawn, and the name says so. */
          readonly chosen: boolean;
      }
    | {
          readonly kind: 'keepAsWritten';
          readonly label: string;
          readonly hint: string;
          readonly name: string;
          /** Keep as written is an action, never a held choice. */
          readonly chosen: false;
      };

/** Search for a food, or why it cannot run now. */
export type SearchView =
    | { readonly kind: 'available'; readonly label: string; readonly name: string }
    | { readonly kind: 'unavailable'; readonly text: string };

/** What an open line shows. */
export interface PasteMatchOpenView {
    /** The muted sentence that says what the line needs. */
    readonly prompt: string;
    readonly search: SearchView;
    /** The accessible name of the line's group of options. */
    readonly optionsName: string;
    /** The options, in the server's order, then Keep as written. */
    readonly rows: readonly FoodChoiceRow[];
}

/** What a collapsed open line says it needs. */
export interface PasteMatchClosedView {
    readonly need: string;
}

/** A settled line's status line. */
export type PasteMatchStatus =
    /** A bound food: drawn with a check. `yourChoice` is said after a food the cook picked. */
    | { readonly kind: 'food'; readonly food: string; readonly yourChoice: string | undefined }
    /** The food under review and its tag; `busy` draws the still spinner while the check runs. */
    | { readonly kind: 'proposal'; readonly food: string; readonly tag: string; readonly busy: boolean }
    /** A sentence: muted, or `attention` for a failure. */
    | { readonly kind: 'text'; readonly text: string; readonly tone: 'muted' | 'attention' };

/** A control a settled line offers. */
export interface PasteMatchAction {
    readonly kind: 'change' | 'useThis' | 'search' | 'keepAsWritten' | 'retry';
    readonly label: string;
    readonly name: string;
    /** The glyph drawn before the label; decorative, the label names the control. */
    readonly icon: IconName;
}

/** An action, or the words that stand where one cannot run (offline search). */
export type PasteMatchActionItem = PasteMatchAction | { readonly kind: 'unavailable'; readonly text: string };

/** What a settled line shows. */
export interface PasteMatchRowView {
    readonly status: PasteMatchStatus;
    /** The control beside the status, at its end (Change, beside a bound food). */
    readonly trailing: PasteMatchAction | undefined;
    /** The controls on their own line under the status, in reading order. */
    readonly actions: readonly PasteMatchActionItem[];
    /** A late review result: one quiet sentence, then See why. */
    readonly note: { readonly sentence: string; readonly seeWhy: string; readonly seeWhyName: string } | undefined;
}

/** The counts the summary states. */
export interface PasteMatchCounts {
    readonly added: number;
    readonly choose: number;
    readonly checking: number;
    readonly matched: number;
}

/** The summary above the pasted lines. */
export interface PasteMatchSummaryView {
    readonly added: string;
    /** The non-zero counts, in the spec's order; `''` when every count is 0. */
    readonly counts: string;
    readonly rule: string;
}

/**
 * The line as the cook wrote it, as one string: the measure, a space, the words. Pure.
 *
 * @param line - The line.
 * @returns The line's text.
 */
export const lineTextOf = (line: PastedLineText): string =>
    line.measure === '' ? line.words : `${line.measure} ${line.words}`;

/** A food's row: its tag and its name follow its own flag and the line's held pick. Pure. */
const foodRowOf = (food: FoodChoice, chosenId: string | undefined, copy: Copy): FoodChoiceRow => {
    const withParts =
        food.detailParts === undefined
            ? food.name
            : fillTemplate(copy.pasteMatch.line.optionWithParts, {
                  food: food.name,
                  parts: food.detailParts.join(', '),
              });
    const tagged = food.isDefault ? fillTemplate(copy.foodSearch.defaultOptionName, { food: withParts }) : withParts;
    const chosen = food.id === chosenId;

    return {
        kind: 'food',
        id: food.id,
        label: food.name,
        detailParts: food.detailParts,
        tag: food.isDefault ? copy.foodSearch.defaultTag : undefined,
        name: chosen ? fillTemplate(copy.pasteMatch.line.chosenName, { food: tagged }) : tagged,
        chosen,
    };
};

/** The need's options and held pick; a line with no match has neither. Pure. */
const optionsOf = (
    need: OpenNeed,
): { readonly options: readonly FoodChoice[]; readonly chosenId: string | undefined } =>
    need.kind === 'noMatch' ? { options: [], chosenId: undefined } : need;

/** The muted prompt for a need. Pure. */
const promptOf = (need: OpenNeed, copy: Copy): string => {
    switch (need.kind) {
        case 'default':
            return fillTemplate(copy.pasteMatch.line.default.prompt, { noun: need.noun });
        case 'needsChoice':
            return copy.pasteMatch.line.needsChoice.prompt;
        case 'noMatch':
            return copy.pasteMatch.line.noMatch.prompt;

        default: {
            const unhandled: never = need;

            return unhandled;
        }
    }
};

/** Search for a food on a line, or the words that stand in for it offline. Pure. */
const searchOf = (text: string, online: boolean, copy: Copy): SearchView =>
    online
        ? {
              kind: 'available',
              label: copy.pasteMatch.line.search,
              name: fillTemplate(copy.pasteMatch.line.searchName, { line: text }),
          }
        : { kind: 'unavailable', text: copy.pasteMatch.offline.searchNeedsNetwork };

/**
 * What an open line shows: the prompt, Search for a food first, then the options in the server's order, then Keep as
 * written. Pure.
 *
 * @param open - The line.
 * @param online - Whether search can run.
 * @param copy - The localised copy.
 * @returns The open line's view.
 */
export const pasteMatchOpenViewOf = (open: OpenLine, online: boolean, copy: Copy): PasteMatchOpenView => {
    const text = lineTextOf(open.line);
    const { options, chosenId } = optionsOf(open.need);
    const keep = fillTemplate(copy.pasteMatch.line.keepAsWritten, { line: text });

    return {
        prompt: promptOf(open.need, copy),
        search: searchOf(text, online, copy),
        optionsName: fillTemplate(copy.pasteMatch.line.optionsName, { line: text }),
        rows: [
            ...options.map((food) => foodRowOf(food, chosenId, copy)),
            { kind: 'keepAsWritten', label: keep, hint: copy.pasteMatch.line.keepHint, name: keep, chosen: false },
        ],
    };
};

/**
 * What a collapsed open line says it needs ("Choose a food · 5 options"). Pure.
 *
 * @param open - The line.
 * @param copy - The localised copy.
 * @param locale - The active locale, for the count's plural form.
 * @returns The collapsed line's view.
 */
export const pasteMatchClosedViewOf = (open: OpenLine, copy: Copy, locale: string): PasteMatchClosedView => {
    const { need } = open;

    switch (need.kind) {
        case 'default':
            return {
                need: fillTemplate(pluralOf(copy.pasteMatch.line.closedNeedDefault, need.options.length, locale), {
                    noun: need.noun,
                }),
            };
        case 'needsChoice':
            return { need: pluralOf(copy.pasteMatch.line.closedNeed, need.options.length, locale) };
        case 'noMatch':
            return { need: copy.pasteMatch.line.closedNeedNoMatch };

        default: {
            const unhandled: never = need;

            return unhandled;
        }
    }
};

/** Search as an action on a settled line, or its offline words. Pure. */
const searchActionOf = (text: string, online: boolean, copy: Copy): PasteMatchActionItem => {
    const search = searchOf(text, online, copy);

    return search.kind === 'available'
        ? { kind: 'search', label: search.label, name: search.name, icon: 'search' }
        : search;
};

/** Keep as written, as the quiet action on a settled line. Pure. */
const keepActionOf = (text: string, copy: Copy): PasteMatchAction => ({
    kind: 'keepAsWritten',
    label: copy.pasteMatch.line.keepAsWrittenShort,
    name: fillTemplate(copy.pasteMatch.line.keepAsWritten, { line: text }),
    icon: 'listPlus',
});

/** Change, beside a bound food. Pure. */
const changeOf = (text: string, copy: Copy): PasteMatchAction => ({
    kind: 'change',
    label: copy.pasteMatch.line.change,
    name: fillTemplate(copy.pasteMatch.line.changeName, { line: text }),
    icon: 'pencilLine',
});

/**
 * What a settled line shows: its status, the control beside it, the controls under it, and a late review note. Pure.
 *
 * @param settled - The line.
 * @param online - Whether search and the check can run.
 * @param copy - The localised copy.
 * @returns The settled line's view.
 */
export const pasteMatchRowViewOf = (settled: SettledLine, online: boolean, copy: Copy): PasteMatchRowView => {
    const text = lineTextOf(settled.line);
    const line = copy.pasteMatch.line;

    switch (settled.kind) {
        case 'matched':
            return {
                status: { kind: 'food', food: settled.food, yourChoice: undefined },
                trailing: changeOf(text, copy),
                actions: [],
                note: undefined,
            };
        case 'chosen':
            return {
                status: { kind: 'food', food: settled.food, yourChoice: line.yourChoice },
                trailing: changeOf(text, copy),
                actions: [],
                note:
                    settled.reviewNote === undefined
                        ? undefined
                        : {
                              sentence: fillTemplate(line.lateSuggestion, { food: settled.reviewNote.suggestedFood }),
                              seeWhy: line.seeWhy,
                              seeWhyName: fillTemplate(line.seeWhyName, {
                                  food: settled.reviewNote.suggestedFood,
                                  line: text,
                              }),
                          },
            };

        case 'checking': {
            const useThis: PasteMatchAction = {
                kind: 'useThis',
                label: line.useThis,
                name: fillTemplate(line.useThisName, { food: settled.proposal, line: text }),
                icon: 'check',
            };

            return {
                status: {
                    kind: 'proposal',
                    food: settled.proposal,
                    tag: online ? line.checking.tag : line.checking.paused,
                    busy: online,
                },
                trailing: undefined,
                // Online, the check is still deciding, so the line offers what a cook needs now: take the proposal, or
                // search. Offline nothing will decide, so keeping the line as written is offered too (the board).
                actions: online
                    ? [useThis, searchActionOf(text, online, copy)]
                    : [useThis, searchActionOf(text, online, copy), keepActionOf(text, copy)],
                note: undefined,
            };
        }

        case 'optionsFailed':
            return {
                status: { kind: 'text', text: copy.pasteMatch.optionsError, tone: 'attention' },
                trailing: undefined,
                actions: [
                    {
                        kind: 'retry',
                        label: copy.pasteMatch.retry,
                        name: fillTemplate(copy.pasteMatch.retryName, { line: text }),
                        icon: 'refreshCw',
                    },
                    searchActionOf(text, online, copy),
                    keepActionOf(text, copy),
                ],
                note: undefined,
            };
        case 'keptAsWritten':
            return {
                status: { kind: 'text', text: line.keptAsWritten, tone: 'muted' },
                trailing: undefined,
                actions: [],
                note: undefined,
            };

        default: {
            const unhandled: never = settled;

            return unhandled;
        }
    }
};

/**
 * The summary above the pasted lines: how many were added, the non-zero counts in the spec's order, and the rule. Pure.
 *
 * @param counts - The counts.
 * @param copy - The localised copy.
 * @param locale - The active locale, for each count's plural form.
 * @returns The summary's view.
 */
export const pasteMatchSummaryOf = (counts: PasteMatchCounts, copy: Copy, locale: string): PasteMatchSummaryView => {
    const summary = copy.pasteMatch.summary;
    const parts = [
        [summary.choose, counts.choose],
        [summary.checking, counts.checking],
        [summary.matched, counts.matched],
    ] as const;

    return {
        added: pluralOf(summary.added, counts.added, locale),
        counts: parts
            .filter(([, count]) => count > 0)
            .map(([text, count]) => pluralOf(text, count, locale))
            .join(summary.separator),
        rule: summary.rule,
    };
};

/**
 * The daily limit's notice (004 FR-022), with the time matching starts again in the cook's locale. Pure.
 *
 * @param resetsAt - When the limit resets, ISO 8601 (the refusal's `resetsAt`).
 * @param copy - The localised copy.
 * @param locale - The active locale.
 * @param timeZone - The cook's IANA time zone; `undefined` reads the runtime's own.
 * @returns The notice's sentence.
 */
export const quotaBodyOf = (resetsAt: string, copy: Copy, locale: string, timeZone: string | undefined): string =>
    fillTemplate(copy.pasteMatch.quota.body, {
        time: new Intl.DateTimeFormat(locale, {
            timeStyle: 'short',
            ...(timeZone === undefined ? {} : { timeZone }),
        }).format(new Date(resetsAt)),
    });

/** Where the side pane stands among the open lines. */
export interface PanePlace {
    /** The shown line's place among the open lines, from 0. */
    readonly index: number;
    /** How many open lines there are. */
    readonly count: number;
}

/** A step control of the side pane: always drawn, disabled at an end, so nothing moves under the cook. */
export interface PaneStep {
    readonly label: string;
    readonly disabled: boolean;
}

/** What the side pane at 1194 and on web shows. */
export interface PasteMatchPaneView {
    /** The pane's accessible name. */
    readonly label: string;
    readonly position: string;
    /** The line, as the pane's heading. */
    readonly heading: string;
    readonly open: PasteMatchOpenView;
    readonly previous: PaneStep;
    readonly next: PaneStep;
}

/**
 * What the side pane shows for the open line it is on. Pure.
 *
 * @param open - The line.
 * @param place - Where it stands among the open lines.
 * @param online - Whether search can run.
 * @param copy - The localised copy.
 * @returns The pane's view.
 */
export const pasteMatchPaneViewOf = (
    open: OpenLine,
    place: PanePlace,
    online: boolean,
    copy: Copy,
): PasteMatchPaneView => {
    const pane = copy.pasteMatch.pane;

    return {
        label: pane.label,
        position: fillTemplate(pane.position, { n: place.index + 1, total: place.count }),
        heading: lineTextOf(open.line),
        open: pasteMatchOpenViewOf(open, online, copy),
        previous: { label: pane.previous, disabled: place.index <= 0 },
        next: { label: pane.next, disabled: place.index >= place.count - 1 },
    };
};

/** A notice above the pasted lines. */
export type PasteMatchNotice =
    /** Offline: the check waits, choices are kept where the draft is (D7). */
    | { readonly kind: 'offline'; readonly keep: DraftKeep }
    /** The daily limit (004 FR-022): the lines are kept as written until it resets. */
    | { readonly kind: 'quota'; readonly resetsAt: string; readonly timeZone: string | undefined };

/**
 * A notice's sentence. Pure.
 *
 * @param notice - The notice.
 * @param copy - The localised copy.
 * @param locale - The active locale.
 * @returns The sentence.
 */
export const pasteMatchNoticeOf = (notice: PasteMatchNotice, copy: Copy, locale: string): string => {
    switch (notice.kind) {
        case 'offline':
            return notice.keep === 'disk' ? copy.pasteMatch.offline.bodyDevice : copy.pasteMatch.offline.bodyTab;
        case 'quota':
            return quotaBodyOf(notice.resetsAt, copy, locale, notice.timeZone);

        default: {
            const unhandled: never = notice;

            return unhandled;
        }
    }
};
