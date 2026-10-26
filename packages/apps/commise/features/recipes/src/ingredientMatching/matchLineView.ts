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
 * - While a send is in flight (a pick, a pick through Search, or Use this), the control that started it reads busy and
 *   the line refuses a press, in its list, on its settled row and on its collapsed row alike, so a double press cannot
 *   send two.
 * - A food bound through Search that is not a candidate is drawn first, chosen, when the line is reopened.
 * - A send that failed says so in one attention sentence with Try again, until a retry is in flight. The view also
 *   names the control a retry lands focus on (`landing`) and carries the line's send state (`send`), so a surface can
 *   keep focus through Try again (`retryFocus.ts`).
 * - A focus request on a line's list always lands: on Search, else the first option, else Keep as written.
 *
 * Pure and platform-agnostic.
 *
 * @pattern Presentation Model — each line's view state derived once for every leaf of both flows
 * @pattern Visitor — exhaustive switches with no default branch over the line state (the row kind's is `MatchRow`'s)
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
    type PendingSend,
} from './matchLine.js';
import type { MatchLineMessages } from './messages.js';
import type { SendState } from './retryFocus.js';

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
    /** What the host is sending for this line, if anything is in flight. */
    readonly pending: PendingSend | undefined;
    /** The line's last send failed, and nothing has been sent for it since. */
    readonly failed: boolean;
}

/** What a food-choice list's host knows: whether search can run, and the pick in flight. */
export type ListPlace = Pick<LinePlace, 'online' | 'pending'>;

/** What an expanded line's host knows: its list's place, and whether the line's last send failed. */
export type OpenPlace = Pick<LinePlace, 'online' | 'pending' | 'failed'>;

/** Search for a food, or why it cannot run now. */
export type SearchView =
    | {
          readonly kind: 'available';
          readonly label: string;
          readonly name: string;
          /** A food the cook found through Search is being sent. */
          readonly busy: boolean;
      }
    | { readonly kind: 'unavailable'; readonly text: string };

/** The control a focus request on a list lands on: the first one the list draws. */
export type ListFocusTarget =
    { readonly kind: 'search' } | { readonly kind: 'row'; readonly id: string } | { readonly kind: 'keep' };

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

/** The last row of a line's list: keep the line as written, with no food, said as one string with "no nutrition". */
export interface KeepRow {
    readonly id: string;
    readonly pick: { readonly kind: 'asWritten' };
    readonly label: string;
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
    /** A send is in flight: every control but the busy one refuses a press (and keeps focus, on web). */
    readonly refusing: boolean;
    /** Where a focus request lands. Always a control the list draws, so the request is always taken. */
    readonly focusTarget: ListFocusTarget;
    /**
     * Where focus lands when a retry starts and Try again unmounts: the control the send made busy, else the
     * `focusTarget`. Always a control the list draws, and never natively disabled, so the request is always taken.
     */
    readonly landing: ListFocusTarget;
}

/** A send that failed: the attention sentence, and Try again. */
export interface PickFailureView {
    readonly text: string;
    readonly retry: { readonly label: string; readonly name: string };
}

/** What the expanded line shows. */
export interface OpenLineView {
    /**
     * The muted sentence over the list; `undefined` for a line nothing about which needs a choice — a bound line
     * reopened by Change, or a confident one.
     */
    readonly prompt: string | undefined;
    /** The line's last send failed. */
    readonly failure: PickFailureView | undefined;
    /** Whether the last send failed and whether one is in flight: what tells a retry from a first attempt. */
    readonly send: SendState;
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
    /** This control's send is in flight (Use this, Keep as written). */
    readonly busy: boolean;
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
    /** The line's last send failed. */
    readonly failure: PickFailureView | undefined;
    /** Whether the last send failed and whether one is in flight: what tells a retry from a first attempt. */
    readonly send: SendState;
    /**
     * The control focus lands on when a retry starts and Try again unmounts: the one the send made busy, else Change,
     * else the first action. The line always draws it, and it is never natively disabled.
     */
    readonly landing: SettledAction['kind'];
    /**
     * A send for this line is in flight: every control refuses a press. The control that started it reads busy, and it
     * refuses a press too.
     */
    readonly refusing: boolean;
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
          /** A send for the line is in flight (from the side pane): the row refuses to open. */
          readonly refusing: boolean;
          /** The line's last send failed, said in attention in place of its need; Try again is where it was sent. */
          readonly failure: string | undefined;
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

/** Search for a food on a line, busy while a food found through it is sent, or its offline words. Pure. */
const searchOf = (text: string, place: ListPlace, copy: MatchCopy): SearchView =>
    place.online
        ? {
              kind: 'available',
              label: copy.line.search,
              name: fillTemplate(copy.line.searchName, { line: text }),
              busy: place.pending?.kind === 'searchPick',
          }
        : { kind: 'unavailable', text: copy.line.searchNeedsNetwork };

/**
 * The foods a list draws: a food bound through Search that is not a candidate first, built from the pick, so a reopened
 * line shows what it holds; then the candidates in the server's order. Pure.
 */
const listedFoodsOf = (line: MatchLine): readonly FoodChoice[] => {
    const candidates = candidatesOf(line);
    const pick = line.binding?.pick;

    if (pick?.kind !== 'food' || candidates.some((food) => food.id === pick.foodId)) {
        return candidates;
    }

    return [{ id: pick.foodId, name: pick.name, isDefault: false }, ...candidates];
};

/** Where a focus request on a list lands: Search, else its first option, else Keep as written. Pure. */
const focusTargetOf = (search: SearchView, rows: readonly FoodChoiceRow[]): ListFocusTarget => {
    if (search.kind === 'available') {
        return { kind: 'search' };
    }

    const [first] = rows;

    return first === undefined ? { kind: 'keep' } : { kind: 'row', id: first.id };
};

/**
 * Where focus lands when a retry starts: the control the send made busy, which the list still draws, else where a focus
 * request lands. Pure.
 */
const listLandingOf = (
    search: SearchView,
    rows: readonly FoodChoiceRow[],
    keep: KeepRow,
    focusTarget: ListFocusTarget,
): ListFocusTarget => {
    if (search.kind === 'available' && search.busy) {
        return { kind: 'search' };
    }

    const busyRow = rows.find((row) => row.busy);

    if (busyRow !== undefined) {
        return { kind: 'row', id: busyRow.id };
    }

    return keep.busy ? { kind: 'keep' } : focusTarget;
};

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
    const pendingId = place.pending?.kind === 'pick' ? optionIdOf(place.pending.pick) : undefined;
    const keepPick = { kind: 'asWritten' } as const;
    const keepId = optionIdOf(keepPick);
    const keepLabel = fillTemplate(copy.line.keepAsWritten, { line: text });
    const keepChosen = keepId === boundId;
    const search = searchOf(text, place, copy);
    const rows = listedFoodsOf(line).map((food) => foodRowOf(food, boundId, pendingId, copy));
    const keep: KeepRow = {
        id: keepId,
        pick: keepPick,
        label: keepLabel,
        name: keepChosen ? fillTemplate(copy.line.chosenName, { food: keepLabel }) : keepLabel,
        chosen: keepChosen,
        busy: keepId === pendingId,
    };
    const focusTarget = focusTargetOf(search, rows);

    return {
        search,
        optionsName: fillTemplate(copy.line.optionsName, { line: text }),
        rows,
        keep,
        refusing: place.pending !== undefined,
        focusTarget,
        landing: listLandingOf(search, rows, keep, focusTarget),
    };
}

/**
 * Whether a control is the one a list's focus request lands on, so each leaf asks the view rather than restating the
 * rule. Pure.
 *
 * @param target - The list's `focusTarget`.
 * @param control - The control asking.
 * @returns `true` for the one control the request lands on.
 */
export function isFocusTarget(target: ListFocusTarget, control: ListFocusTarget): boolean {
    switch (target.kind) {
        case 'search':
        case 'keep':
            return control.kind === target.kind;
        case 'row':
            return control.kind === 'row' && control.id === target.id;
    }
}

/**
 * A failed send, worded for one line: the attention sentence and Try again named for the line. The ONE place the words
 * are put together, for a matched line (`lineFailureOf`) and for a surface that holds the line only as text (the flagged
 * list's rows). Pure.
 *
 * @param text - The line as the cook wrote it.
 * @param copy - The localised copy.
 * @returns The failure's view.
 */
export function pickFailureViewOf(text: string, copy: MatchCopy): PickFailureView {
    return {
        text: copy.line.pickFailed,
        retry: { label: copy.line.retry, name: fillTemplate(copy.line.pickRetryName, { line: text }) },
    };
}

/**
 * A send's failure, shown until a retry is in flight. The ONE place the hide-while-retrying rule lives, for a matched
 * line and for a surface that holds the line only as text (the flagged list's rows). Pure.
 *
 * @param text - The line as the cook wrote it.
 * @param place - Whether the line's last send failed, and the send in flight.
 * @param copy - The localised copy.
 * @returns The failure to draw, or `undefined` when the line did not fail or a retry is in flight.
 */
export function lineFailureOf(
    text: string,
    place: Pick<OpenPlace, 'failed' | 'pending'>,
    copy: MatchCopy,
): PickFailureView | undefined {
    return place.failed && place.pending === undefined ? pickFailureViewOf(text, copy) : undefined;
}

/**
 * A line's send state: whether its last send failed and whether one is in flight. What a surface needs to tell a retry
 * (`failed` and `sending`) from a first attempt, so Try again can keep focus (`retryFocus.ts`). Pure.
 *
 * @param key - The line.
 * @param place - Whether the line's last send failed, and the send in flight.
 * @returns The line's send state.
 */
export function sendStateOf(key: string, place: Pick<OpenPlace, 'failed' | 'pending'>): SendState {
    return { key, failed: place.failed, sending: place.pending !== undefined };
}

/** The muted prompt over an open line, by its state; none once something is bound (a Change). Pure. */
const promptOf = (line: MatchLine, copy: MatchCopy): string | undefined => {
    if (line.binding !== undefined) {
        return undefined;
    }

    switch (line.state) {
        case 'default':
            return fillTemplate(copy.line.prompt.default, { noun: line.noun });
        case 'needsChoice':
            return copy.line.prompt.needsChoice;
        case 'noMatch':
            return copy.line.prompt.noMatch;

        // A confident line always arrives bound, so it never reaches here.
        case 'checking':
        case 'optionsFailed':
            return undefined;
    }
};

/**
 * What an expanded line shows: its muted prompt, a failed send's sentence, and its food-choice list. The open row's,
 * and the side pane's (1194 and web), so the two say the same. Pure.
 *
 * @param line - The line.
 * @param place - Whether search can run, the send in flight, and whether the last one failed.
 * @param copy - The localised copy.
 * @returns The expanded line's view.
 */
export function openLineViewOf(line: MatchLine, place: OpenPlace, copy: MatchCopy): OpenLineView {
    return {
        prompt: promptOf(line, copy),
        failure: lineFailureOf(lineTextOf(line.line), place, copy),
        send: sendStateOf(line.key, place),
        list: choiceListViewOf(line, place, copy),
    };
}

/** The expanded line's row. Pure. */
const openRowOf = (line: MatchLine, place: LinePlace, copy: MatchCopy): LineRow => ({
    kind: 'open',
    key: line.key,
    line: line.line,
    view: openLineViewOf(line, place, copy),
});

/** A collapsed open line's row. Pure. */
const closedRowOf = (line: MatchLine, need: string, place: LinePlace, copy: MatchCopy): LineRow => ({
    kind: 'closed',
    key: line.key,
    line: line.line,
    need,
    current: place.current,
    refusing: place.pending !== undefined,
    failure: lineFailureOf(lineTextOf(line.line), place, copy)?.text,
});

/** Change, beside a bound line. Pure. */
const changeOf = (text: string, copy: MatchCopy): SettledAction => ({
    kind: 'change',
    label: copy.line.change,
    name: fillTemplate(copy.line.changeName, { line: text }),
    icon: 'pencilLine',
    busy: false,
});

/** Search as an action on a settled line, busy while a food found through it is sent, or its offline words. Pure. */
const searchActionOf = (text: string, place: ListPlace, copy: MatchCopy): SettledActionItem => {
    const search = searchOf(text, place, copy);

    return search.kind === 'available'
        ? { kind: 'search', label: search.label, name: search.name, icon: 'search', busy: search.busy }
        : search;
};

/** Keep as written, as the quiet action on a checking or failed line; busy while that pick is in flight. Pure. */
const keepActionOf = (text: string, pending: PendingSend | undefined, copy: MatchCopy): SettledAction => ({
    kind: 'keepAsWritten',
    label: copy.line.keepAsWrittenShort,
    name: fillTemplate(copy.line.keepAsWrittenName, { line: text }),
    icon: 'listPlus',
    busy: pending?.kind === 'pick' && pending.pick.kind === 'asWritten',
});

/**
 * The control a retry lands on when it starts: the one the send made busy, else the line's first control (Change on a
 * bound line), which the row always draws and which only refuses a press. Pure.
 */
const settledLandingOf = (first: SettledAction, items: readonly SettledActionItem[]): SettledAction['kind'] => {
    const controls = [first, ...items.filter((item): item is SettledAction => item.kind !== 'unavailable')];

    return (controls.find((control) => control.busy) ?? first).kind;
};

/** Whether the bound food is the line's default, so a binding not the cook's keeps the Default tag. Pure. */
const isDefaultFood = (line: MatchLine, foodId: string): boolean =>
    candidatesOf(line).some((food) => food.id === foodId && food.isDefault);

/** A bound line's settled row: its food or "kept as written", Change, and a late note on the cook's pick. Pure. */
const boundRowOf = (line: MatchLine, binding: LineBinding, place: LinePlace, copy: MatchCopy): LineRow => {
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

    const change = changeOf(text, copy);

    return {
        kind: 'settled',
        key: line.key,
        line: line.line,
        view: {
            status,
            trailing: change,
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
            failure: lineFailureOf(text, place, copy),
            send: sendStateOf(line.key, place),
            landing: settledLandingOf(change, []),
            refusing: place.pending !== undefined,
        },
    };
};

/** An unbound checking line's settled row: the proposal, Use this, Search (and Keep as written offline). Pure. */
const checkingRowOf = (line: MatchLine, proposal: string, place: LinePlace, copy: MatchCopy): LineRow => {
    const text = lineTextOf(line.line);
    const { online, pending } = place;
    const useThis: SettledAction = {
        kind: 'useThis',
        label: copy.line.useThis,
        name: fillTemplate(copy.line.useThisName, { food: proposal, line: text }),
        icon: 'check',
        busy: pending?.kind === 'useProposal',
    };

    const actions: readonly SettledActionItem[] = online
        ? [useThis, searchActionOf(text, place, copy)]
        : [useThis, searchActionOf(text, place, copy), keepActionOf(text, pending, copy)];

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
            actions,
            note: undefined,
            failure: lineFailureOf(text, place, copy),
            send: sendStateOf(line.key, place),
            landing: settledLandingOf(useThis, actions),
            refusing: pending !== undefined,
        },
    };
};

/** A line whose options failed: the amber sentence, Try again, Search and Keep as written. Pure. */
const failedRowOf = (line: MatchLine, place: LinePlace, copy: MatchCopy): LineRow => {
    const text = lineTextOf(line.line);
    const { pending } = place;
    const retry: SettledAction = {
        kind: 'retry',
        label: copy.line.retry,
        name: fillTemplate(copy.line.retryName, { line: text }),
        icon: 'refreshCw',
        busy: false,
    };
    const actions: readonly SettledActionItem[] = [
        retry,
        searchActionOf(text, place, copy),
        keepActionOf(text, pending, copy),
    ];

    return {
        kind: 'settled',
        key: line.key,
        line: line.line,
        view: {
            status: { kind: 'text', text: copy.line.optionsError, tone: 'attention' },
            trailing: undefined,
            actions,
            note: undefined,
            failure: lineFailureOf(text, place, copy),
            send: sendStateOf(line.key, place),
            landing: settledLandingOf(retry, actions),
            refusing: pending !== undefined,
        },
    };
};

/**
 * The send state of each row that draws a Try again or a control a retry lands on (an open or a settled row), for the
 * list's `useRetryFocus`. A collapsed row has neither: its Try again is in the side pane. Pure.
 *
 * @param rows - The list's rows.
 * @returns The send states, in the rows' order.
 */
export function sendsOf(rows: readonly LineRow[]): readonly SendState[] {
    return rows.flatMap((row) => (row.kind === 'closed' ? [] : [row.view.send]));
}

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
                      copy,
                  )
                : boundRowOf(line, line.binding, place, copy);

        case 'needsChoice':
            if (place.expanded) {
                return openRowOf(line, place, copy);
            }

            return line.binding === undefined
                ? closedRowOf(
                      line,
                      pluralOf(copy.line.closedNeed.needsChoice, line.candidates.length, locale),
                      place,
                      copy,
                  )
                : boundRowOf(line, line.binding, place, copy);

        case 'noMatch':
            if (place.expanded) {
                return openRowOf(line, place, copy);
            }

            return line.binding === undefined
                ? closedRowOf(line, copy.line.closedNeed.noMatch, place, copy)
                : boundRowOf(line, line.binding, place, copy);

        case 'confident':
            return place.expanded ? openRowOf(line, place, copy) : boundRowOf(line, line.binding, place, copy);

        case 'checking':
            // Unbound, a checking line reaches search in one tap and is never drawn open; once the cook picked for it,
            // Change opens it to search and Keep as written.
            if (line.binding === undefined) {
                return checkingRowOf(line, line.proposal, place, copy);
            }

            return place.expanded ? openRowOf(line, place, copy) : boundRowOf(line, line.binding, place, copy);

        case 'optionsFailed':
            return failedRowOf(line, place, copy);
    }
}
