/**
 * @module @commise/features-recipes/ingredientMatching — what ONE matched line shows, as a row view model every leaf of
 * both flows (paste in the editor, bulk import) and both platforms renders and decides nothing about
 * (`docs/design/uiRefreshWorkshop5/redesignCanvas/ingredientMatching.md`, owner rulings 2026-10-25).
 *
 * {@link lineRowOf} answers one of three row kinds — `open` (the expanded line: its prompt and its food-choice list),
 * `closed` (an open line waiting its turn, naming its need) and `settled` (a line that needs nothing now: its status,
 * its controls and a late review note) — from an exhaustive switch over the line's state with NO default branch, so a
 * new state is a compile error here, and a new row kind is a compile error in every leaf's `switch (row.kind)`.
 *
 * The rulings it holds:
 * - A default is tagged by its flag and NEVER chosen for the cook; the server's order is kept.
 * - Search for a food first (ruling I1), then the options, then "Keep … as written" last.
 * - Only a COOK's binding says "your choice"; a default the server bound keeps its Default tag.
 * - A late review result never replaces the cook's pick: it adds one sentence, and See why carries its reason.
 * - Every line kept as written offers Change, whoever kept it (staff-ux 2026-10-25, ruling I1).
 * - Prompts are muted; only a failure is `attention` (amber).
 * - Offline, search says it needs the network, and the options already loaded can still be chosen.
 * - Every control's accessible name starts with its visible words and names its line (WCAG 2.5.3, 2.4.6).
 * - While a pick is in flight, its row reads busy and every row of the list refuses a press, so a double press cannot
 *   send two picks.
 *
 * Pure and platform-agnostic.
 *
 * @pattern Presentation Model — each line's view state derived once for every leaf of both flows
 * @pattern Visitor — exhaustive switches with no default branch over the line state and the row kind
 */
import type { IconName } from '@commise/ui/icon';

import { fillTemplate } from '../format/fillTemplate.js';
import { pluralOf } from '../format/plural.js';
import type { IngredientDetailsMessages } from '../messages.js';
import { foodChoiceNameOf } from './foodChoiceName.js';
import {
    candidatesOf,
    lineTextOf,
    optionIdOf,
    type FoodChoice,
    type LineBinding,
    type LinePick,
    type LineText,
    type MatchLine,
} from './matchLine.js';
import type { MatchLineMessages } from './messages.js';

/** The copy the view reads: the line's, and the picker's words for a food's parts (one naming rule). */
export interface MatchCopy {
    readonly line: MatchLineMessages;
    readonly details: Pick<IngredientDetailsMessages, 'suggestionWithDetails'>;
}

/** Where a line stands in its host's list, and what the host knows that the line does not. */
export interface LinePlace {
    /** The host draws this line expanded (one at a time on phone and 834; Change on a bound line). */
    readonly expanded: boolean;
    /** The side pane shows this line (1194 and web): its collapsed row is marked current. */
    readonly current: boolean;
    /** Whether search and the review can run. */
    readonly online: boolean;
    /** The pick the host is sending for this line, if one is in flight. */
    readonly pending: LinePick | undefined;
}

/** What a food-choice list's host knows: whether search can run, and the pick in flight. */
export type ListPlace = Pick<LinePlace, 'online' | 'pending'>;

/** Search for a food, or why it cannot run now. */
export type SearchView =
    | { readonly kind: 'available'; readonly label: string; readonly name: string }
    | { readonly kind: 'unavailable'; readonly text: string };

/** One food of a line's list: a button whose press is the pick (never a radio). */
export interface FoodChoiceRow {
    /** Unique in the list (`optionIdOf`). */
    readonly id: string;
    /** What a press sends. */
    readonly pick: LinePick;
    readonly label: string;
    readonly detailParts: readonly [string, ...string[]] | undefined;
    /** The quiet Default tag, on the default food only. */
    readonly tag: string | undefined;
    /** The row's accessible name: the label, its parts, its tag, and ", chosen" when it is the bound food. */
    readonly name: string;
    /** The bound food of a reopened line: a check is drawn, and the name says so. */
    readonly chosen: boolean;
    /** This pick is in flight. */
    readonly busy: boolean;
}

/** The last row of a line's list: keep the line as written, with no food. */
export interface KeepRow {
    readonly id: string;
    readonly pick: { readonly kind: 'asWritten' };
    readonly label: string;
    readonly hint: string;
    readonly name: string;
    readonly chosen: boolean;
    readonly busy: boolean;
}

/** What a food-choice list shows: search, the options in the server's order, then Keep as written. */
export interface FoodChoiceListView {
    readonly search: SearchView;
    /** The accessible name of the group of options. */
    readonly optionsName: string;
    readonly rows: readonly FoodChoiceRow[];
    readonly keep: KeepRow;
    /** A pick is in flight: every row refuses a press (`aria-disabled`, so focus stays where it is). */
    readonly refusing: boolean;
}

/** What the expanded line shows. */
export interface OpenLineView {
    /** The muted sentence over the list; `undefined` for a line nothing about which needs a choice (a Change). */
    readonly prompt: string | undefined;
    readonly list: FoodChoiceListView;
}

/** A settled line's status line. */
export type SettledStatus =
    /** A bound food, said whole ("Whole milk", or "Whole milk · your choice"), with a check; the Default tag if any. */
    | { readonly kind: 'food'; readonly text: string; readonly tag: string | undefined }
    /** The food under review and its tag; `waiting` draws the still clock glyph while the review runs. */
    | { readonly kind: 'proposal'; readonly food: string; readonly tag: string; readonly waiting: boolean }
    /** A sentence: muted, or `attention` for a failure. */
    | { readonly kind: 'text'; readonly text: string; readonly tone: 'muted' | 'attention' };

/** A control a settled line offers. */
export interface SettledAction {
    readonly kind: 'change' | 'useThis' | 'search' | 'keepAsWritten' | 'retry';
    readonly label: string;
    readonly name: string;
    /** The glyph drawn before the label; decorative, the label names the control. */
    readonly icon: IconName;
}

/** An action, or the words that stand where one cannot run (offline search). */
export type SettledActionItem = SettledAction | { readonly kind: 'unavailable'; readonly text: string };

/** A late review result on the cook's pick. */
export interface ReviewNoteView {
    readonly sentence: string;
    /** Why the review suggested another food: what See why shows. */
    readonly reason: string;
    readonly seeWhy: string;
    readonly seeWhyName: string;
}

/** What a settled line shows. */
export interface SettledLineView {
    readonly status: SettledStatus;
    /** The control at the status line's end (Change, beside a bound line). */
    readonly trailing: SettledAction | undefined;
    /** The controls on their own line under the status, in reading order. */
    readonly actions: readonly SettledActionItem[];
    readonly note: ReviewNoteView | undefined;
}

/** One line's row: what every leaf of both flows switches on. */
export type LineRow =
    | { readonly kind: 'open'; readonly key: string; readonly line: LineText; readonly view: OpenLineView }
    | {
          readonly kind: 'closed';
          readonly key: string;
          readonly line: LineText;
          /** What the line needs ("Choose a food · 5 options"), muted. */
          readonly need: string;
          /** The side pane shows this line. Display only; the row does the same thing either way. */
          readonly current: boolean;
      }
    | { readonly kind: 'settled'; readonly key: string; readonly line: LineText; readonly view: SettledLineView };

/** The bound pick's option id, or `undefined` when nothing is bound. Pure. */
const boundIdOf = (binding: LineBinding | undefined): string | undefined =>
    binding === undefined ? undefined : optionIdOf(binding.pick);

/** A food's row of the list. Pure. */
const foodRowOf = (
    food: FoodChoice,
    boundId: string | undefined,
    pendingId: string | undefined,
    copy: MatchCopy,
): FoodChoiceRow => {
    const pick: LinePick = { kind: 'food', foodId: food.id, name: food.name };
    const id = optionIdOf(pick);
    const named = foodChoiceNameOf(
        { name: food.name, detailParts: food.detailParts, isDefault: food.isDefault },
        {
            suggestionWithDetails: copy.details.suggestionWithDetails,
            defaultOptionName: copy.line.defaultOptionName,
            defaultTag: copy.line.defaultTag,
        },
    );
    const chosen = id === boundId;

    return {
        id,
        pick,
        label: food.name,
        detailParts: food.detailParts,
        tag: food.isDefault ? copy.line.defaultTag : undefined,
        name: chosen ? fillTemplate(copy.line.chosenName, { food: named }) : named,
        chosen,
        busy: id === pendingId,
    };
};

/** Search for a food on a line, or the words that stand in for it offline. Pure. */
const searchOf = (text: string, online: boolean, copy: MatchCopy): SearchView =>
    online
        ? { kind: 'available', label: copy.line.search, name: fillTemplate(copy.line.searchName, { line: text }) }
        : { kind: 'unavailable', text: copy.line.searchNeedsNetwork };

/**
 * What a line's food-choice list shows: Search for a food first, then the options in the server's order, then Keep as
 * written. The same list wherever a line is chosen for: inline on phone and 834, the side pane at 1194 and on web, and
 * the flagged line's sheet and pane. Pure.
 *
 * @param line - The line.
 * @param place - Whether search can run, and the pick in flight.
 * @param copy - The localised copy.
 * @returns The list's view.
 */
export function choiceListViewOf(line: MatchLine, place: ListPlace, copy: MatchCopy): FoodChoiceListView {
    const text = lineTextOf(line.line);
    const boundId = boundIdOf(line.binding);
    const pendingId = place.pending === undefined ? undefined : optionIdOf(place.pending);
    const keepPick = { kind: 'asWritten' } as const;
    const keepId = optionIdOf(keepPick);
    const keepLabel = fillTemplate(copy.line.keepAsWritten, { line: text });
    const keepChosen = keepId === boundId;

    return {
        search: searchOf(text, place.online, copy),
        optionsName: fillTemplate(copy.line.optionsName, { line: text }),
        rows: candidatesOf(line).map((food) => foodRowOf(food, boundId, pendingId, copy)),
        keep: {
            id: keepId,
            pick: keepPick,
            label: keepLabel,
            hint: copy.line.keepHint,
            name: keepChosen ? fillTemplate(copy.line.chosenName, { food: keepLabel }) : keepLabel,
            chosen: keepChosen,
            busy: keepId === pendingId,
        },
        refusing: pendingId !== undefined,
    };
}

/** The muted prompt over an open line, by its state. Pure. */
const promptOf = (line: MatchLine, copy: MatchCopy): string | undefined => {
    switch (line.state) {
        case 'default':
            return fillTemplate(copy.line.prompt.default, { noun: line.noun });
        case 'needsChoice':
            return copy.line.prompt.needsChoice;
        case 'noMatch':
            return copy.line.prompt.noMatch;

        case 'confident':
        case 'checking':
        case 'optionsFailed':
            return undefined;
    }
};

/**
 * What an expanded line shows: its muted prompt and its food-choice list. The open row's, and the side pane's (1194 and
 * web), so the two say the same. Pure.
 *
 * @param line - The line.
 * @param place - Whether search can run, and the pick in flight.
 * @param copy - The localised copy.
 * @returns The expanded line's view.
 */
export function openLineViewOf(line: MatchLine, place: ListPlace, copy: MatchCopy): OpenLineView {
    return { prompt: promptOf(line, copy), list: choiceListViewOf(line, place, copy) };
}

/** The expanded line's row. Pure. */
const openRowOf = (line: MatchLine, place: LinePlace, copy: MatchCopy): LineRow => ({
    kind: 'open',
    key: line.key,
    line: line.line,
    view: openLineViewOf(line, place, copy),
});

/** A collapsed open line's row. Pure. */
const closedRowOf = (line: MatchLine, need: string, place: LinePlace): LineRow => ({
    kind: 'closed',
    key: line.key,
    line: line.line,
    need,
    current: place.current,
});

/** Change, beside a bound line. Pure. */
const changeOf = (text: string, copy: MatchCopy): SettledAction => ({
    kind: 'change',
    label: copy.line.change,
    name: fillTemplate(copy.line.changeName, { line: text }),
    icon: 'pencilLine',
});

/** Search as an action on a settled line, or its offline words. Pure. */
const searchActionOf = (text: string, online: boolean, copy: MatchCopy): SettledActionItem => {
    const search = searchOf(text, online, copy);

    return search.kind === 'available'
        ? { kind: 'search', label: search.label, name: search.name, icon: 'search' }
        : search;
};

/** Keep as written, as the quiet action on a checking or failed line. Pure. */
const keepActionOf = (text: string, copy: MatchCopy): SettledAction => ({
    kind: 'keepAsWritten',
    label: copy.line.keepAsWrittenShort,
    name: fillTemplate(copy.line.keepAsWrittenName, { line: text }),
    icon: 'listPlus',
});

/** Whether the bound food is the line's default, so a binding not the cook's keeps the Default tag. Pure. */
const isDefaultFood = (line: MatchLine, foodId: string): boolean =>
    candidatesOf(line).some((food) => food.id === foodId && food.isDefault);

/** A bound line's settled row: its food or "kept as written", Change, and a late note on the cook's pick. Pure. */
const boundRowOf = (line: MatchLine, binding: LineBinding, copy: MatchCopy): LineRow => {
    const text = lineTextOf(line.line);
    const { pick } = binding;
    const byCook = binding.boundBy === 'cook';
    const note = byCook ? binding.reviewNote : undefined;
    let status: SettledStatus;

    if (pick.kind === 'food') {
        status = {
            kind: 'food',
            text: byCook ? fillTemplate(copy.line.chosenStatus, { food: pick.name }) : pick.name,
            tag: !byCook && isDefaultFood(line, pick.foodId) ? copy.line.defaultTag : undefined,
        };
    } else {
        status = { kind: 'text', text: copy.line.keptAsWritten, tone: 'muted' };
    }

    return {
        kind: 'settled',
        key: line.key,
        line: line.line,
        view: {
            status,
            trailing: changeOf(text, copy),
            actions: [],
            note:
                note === undefined
                    ? undefined
                    : {
                          sentence: fillTemplate(copy.line.lateSuggestion, { food: note.suggestedFood }),
                          reason: note.reason,
                          seeWhy: copy.line.seeWhy,
                          seeWhyName: fillTemplate(copy.line.seeWhyName, { food: note.suggestedFood, line: text }),
                      },
        },
    };
};

/** An unbound checking line's settled row: the proposal, Use this, Search (and Keep as written offline). Pure. */
const checkingRowOf = (line: MatchLine, proposal: string, online: boolean, copy: MatchCopy): LineRow => {
    const text = lineTextOf(line.line);
    const useThis: SettledAction = {
        kind: 'useThis',
        label: copy.line.useThis,
        name: fillTemplate(copy.line.useThisName, { food: proposal, line: text }),
        icon: 'check',
    };

    return {
        kind: 'settled',
        key: line.key,
        line: line.line,
        view: {
            status: {
                kind: 'proposal',
                food: proposal,
                tag: online ? copy.line.checking.tag : copy.line.checking.paused,
                waiting: online,
            },
            trailing: undefined,
            // Online the review is still deciding, so the line offers what a cook needs now: take the proposal, or
            // search. Offline nothing will decide, so keeping the line as written is offered too (the board).
            actions: online
                ? [useThis, searchActionOf(text, online, copy)]
                : [useThis, searchActionOf(text, online, copy), keepActionOf(text, copy)],
            note: undefined,
        },
    };
};

/** A line whose options failed: the amber sentence, Try again, Search and Keep as written. Pure. */
const failedRowOf = (line: MatchLine, online: boolean, copy: MatchCopy): LineRow => {
    const text = lineTextOf(line.line);

    return {
        kind: 'settled',
        key: line.key,
        line: line.line,
        view: {
            status: { kind: 'text', text: copy.line.optionsError, tone: 'attention' },
            trailing: undefined,
            actions: [
                {
                    kind: 'retry',
                    label: copy.line.retry,
                    name: fillTemplate(copy.line.retryName, { line: text }),
                    icon: 'refreshCw',
                },
                searchActionOf(text, online, copy),
                keepActionOf(text, copy),
            ],
            note: undefined,
        },
    };
};

/**
 * One line's row: open when the host expands it (and it has a list to show), a collapsed row while an open line waits
 * its turn, and settled otherwise. Pure.
 *
 * @param line - The line.
 * @param place - Where it stands in its host's list.
 * @param copy - The localised copy.
 * @param locale - The active locale, for counts.
 * @returns The row.
 */
export function lineRowOf(line: MatchLine, place: LinePlace, copy: MatchCopy, locale: string): LineRow {
    switch (line.state) {
        case 'default':
            if (place.expanded) {
                return openRowOf(line, place, copy);
            }

            return line.binding === undefined
                ? closedRowOf(
                      line,
                      fillTemplate(pluralOf(copy.line.closedNeed.default, line.candidates.length, locale), {
                          noun: line.noun,
                      }),
                      place,
                  )
                : boundRowOf(line, line.binding, copy);

        case 'needsChoice':
            if (place.expanded) {
                return openRowOf(line, place, copy);
            }

            return line.binding === undefined
                ? closedRowOf(line, pluralOf(copy.line.closedNeed.needsChoice, line.candidates.length, locale), place)
                : boundRowOf(line, line.binding, copy);

        case 'noMatch':
            if (place.expanded) {
                return openRowOf(line, place, copy);
            }

            return line.binding === undefined
                ? closedRowOf(line, copy.line.closedNeed.noMatch, place)
                : boundRowOf(line, line.binding, copy);

        case 'confident':
            return place.expanded ? openRowOf(line, place, copy) : boundRowOf(line, line.binding, copy);

        case 'checking':
            // Unbound, a checking line reaches search in one tap and is never drawn open; once the cook picked for it,
            // Change opens it to search and Keep as written.
            if (line.binding === undefined) {
                return checkingRowOf(line, line.proposal, place.online, copy);
            }

            return place.expanded ? openRowOf(line, place, copy) : boundRowOf(line, line.binding, copy);

        case 'optionsFailed':
            return failedRowOf(line, place.online, copy);
    }
}
