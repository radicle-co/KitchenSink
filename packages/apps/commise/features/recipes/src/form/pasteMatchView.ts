/**
 * @module @commise/features-recipes/form — what the editor's paste flow shows AROUND its matched lines
 * (`docs/design/uiRefreshWorkshop5/redesignCanvas/ingredientMatching.md`, owner rulings 2026-10-25): the summary above
 * the lines, the notice when matching cannot run, and the side pane that steps through the open lines at 1194 and on
 * web. The lines themselves are the neutral `ingredientMatching/` module's (`lineRowOf`), which bulk import reads too.
 * The web and native leaves render what this returns and decide nothing.
 *
 * Pure and platform-agnostic.
 *
 * @pattern Presentation Model — the paste flow's summary, notice and pane derived once for both platform leaves
 * @pattern Visitor — an exhaustive switch with no default branch over the notice union
 */
import type { DraftKeep } from '../editor/saveStatus.js';
import { fillTemplate } from '../format/fillTemplate.js';
import { pluralOf } from '../format/plural.js';
import {
    isOpenLine,
    lineTextOf,
    type MatchCounts,
    type MatchLine,
    type SendingLines,
} from '../ingredientMatching/matchLine.js';
import {
    openLineViewOf,
    type MatchCopy,
    type OpenLineView,
    type OpenPlace,
} from '../ingredientMatching/matchLineView.js';
import type { RecipeFormMessages } from './messages.js';

/** The copy this module reads. */
type PasteCopy = Pick<RecipeFormMessages, 'pasteMatch'>;

/** A notice above the pasted lines. */
export type PasteMatchNotice =
    /** Offline: the check waits, choices are kept where the draft is (D7). */
    | { readonly kind: 'offline'; readonly keep: DraftKeep }
    /** The daily limit (004 FR-022): the lines are kept as written until it resets in the cook's time zone. */
    | { readonly kind: 'quota'; readonly resetsAt: string; readonly timeZone: string };

/** The counts the summary states: how many lines were added, then the line counts (`matchCountsOf`). */
export interface PasteMatchCounts extends MatchCounts {
    readonly added: number;
}

/** The summary above the pasted lines. */
export interface PasteMatchSummaryView {
    readonly added: string;
    /**
     * ONE paragraph (U4): the non-zero counts in the owner's order ("3 matched · 4 to choose · 1 being checked.", commit
     * 7b62777fc), then the rule. Just the rule when every count is 0.
     */
    readonly paragraph: string;
}

/**
 * The summary above the pasted lines: how many were added, then one paragraph of the non-zero counts, in the owner's
 * order and words, and the rule. Whole sentences join with a space, so no count of 0 leaves a stray dot. Pure.
 *
 * @param counts - The counts.
 * @param copy - The localised copy.
 * @param locale - The active locale, for each count's plural form.
 * @returns The summary's view.
 */
export const pasteMatchSummaryOf = (
    counts: PasteMatchCounts,
    copy: PasteCopy,
    locale: string,
): PasteMatchSummaryView => {
    const summary = copy.pasteMatch.summary;
    const parts = [
        [summary.matched, counts.matched],
        [summary.choose, counts.choose],
        [summary.checking, counts.checking],
    ] as const;
    const stated = parts
        .filter(([, count]) => count > 0)
        .map(([text, count]) => pluralOf(text, count, locale))
        .join(summary.separator);

    return {
        added: pluralOf(summary.added, counts.added, locale),
        paragraph: [stated === '' ? undefined : fillTemplate(summary.countsSentence, { counts: stated }), summary.rule]
            .filter((sentence): sentence is string => sentence !== undefined)
            .join(' '),
    };
};

/**
 * The daily limit's notice (004 FR-022), with the time matching starts again in the cook's locale. Pure.
 *
 * @param resetsAt - When the limit resets, ISO 8601 (the refusal's `resetsAt`).
 * @param copy - The localised copy.
 * @param locale - The active locale.
 * @param timeZone - The cook's IANA time zone, resolved by the host: passing it keeps this function pure.
 * @returns The notice's sentence.
 */
export const quotaBodyOf = (resetsAt: string, copy: PasteCopy, locale: string, timeZone: string): string =>
    fillTemplate(copy.pasteMatch.quota.body, {
        time: new Intl.DateTimeFormat(locale, { timeStyle: 'short', timeZone }).format(new Date(resetsAt)),
    });

/** What the side pane steps through: the recipe's lines, the one it shows, and the ones being sent. */
export interface PanePlace {
    /** Every line of the recipe, in order. */
    readonly lines: readonly MatchLine[];
    /** The line the pane shows. It may be settled: a line chosen in the pane stays shown until the cook steps. */
    readonly shownKey: string;
    /** The lines whose choice is being sent: never a step's destination. */
    readonly sending: SendingLines;
}

/** Where the pane stands, and where its two steps go. */
export interface PaneSteps {
    /** The shown line's place among ALL the recipe's lines, from 1. */
    readonly position: number;
    /** Every line of the recipe. */
    readonly total: number;
    /** The open line before the shown one, or `undefined` at the first. */
    readonly previousKey: string | undefined;
    /** The open line after the shown one, or `undefined` at the last. */
    readonly nextKey: string | undefined;
}

/** A step control of the side pane: always drawn, refused at an end (and focusable), so nothing moves under the cook. */
export interface PaneStep {
    readonly label: string;
    /** The pane is at this end: the step refuses a press. */
    readonly disabled: boolean;
}

/** What the side pane at 1194 and on web shows. */
export interface PasteMatchPaneView {
    /** The pane's accessible name (web's `aside`). */
    readonly label: string;
    readonly position: string;
    /** The line, as the pane's heading. */
    readonly heading: string;
    /** The line's prompt and food-choice list, the same the open row shows. */
    readonly open: OpenLineView;
    readonly previous: PaneStep;
    readonly next: PaneStep;
}

/**
 * The pane's place and steps (M4): its position counts over ALL the recipe's lines ("Line 3 of 9"), so a line it shows
 * keeps its place once chosen; Previous and Next go to the previous and next OPEN line not being sent, and never wrap,
 * so each is disabled at an end. The ONE rule the pane disables its steps by and the host steps by. Pure.
 *
 * @param place - The lines, the shown one, and the ones being sent.
 * @returns The position and the two steps.
 * @throws RangeError when the shown key is not among the lines: a host error, said at once rather than drawn wrong.
 */
export const paneStepsOf = (place: PanePlace): PaneSteps => {
    const at = place.lines.findIndex((line) => line.key === place.shownKey);

    if (at < 0) {
        throw new RangeError(`The side pane shows "${place.shownKey}", which is not one of the lines.`);
    }

    const steppable = (line: MatchLine): boolean => isOpenLine(line) && !place.sending.has(line.key);

    return {
        position: at + 1,
        total: place.lines.length,
        // The nearest open line before the shown one: the slice is a copy, so reversing it touches no caller's array.
        previousKey: place.lines.slice(0, at).reverse().find(steppable)?.key,
        nextKey: place.lines.slice(at + 1).find(steppable)?.key,
    };
};

/**
 * What the side pane shows for the line it is on. Pure.
 *
 * @param place - The lines, the shown one, and the ones being sent.
 * @param list - Whether search can run, the send in flight for the shown line, and whether its last one failed.
 * @param copy - The paste flow's copy.
 * @param lineCopy - The matched line's copy.
 * @returns The pane's view.
 * @throws RangeError when the shown key is not among the lines (`paneStepsOf`).
 */
export const pasteMatchPaneViewOf = (
    place: PanePlace,
    list: OpenPlace,
    copy: PasteCopy,
    lineCopy: MatchCopy,
): PasteMatchPaneView => {
    const pane = copy.pasteMatch.pane;
    const steps = paneStepsOf(place);
    // `paneStepsOf` has already refused a key that is not among the lines, so this index holds the shown line.
    const line = place.lines[steps.position - 1];

    if (line === undefined) {
        throw new RangeError(`The side pane shows "${place.shownKey}", which is not one of the lines.`);
    }

    return {
        label: pane.label,
        position: fillTemplate(pane.position, { n: steps.position, total: steps.total }),
        heading: lineTextOf(line.line),
        open: openLineViewOf(line, list, lineCopy),
        previous: { label: pane.previous, disabled: steps.previousKey === undefined },
        next: { label: pane.next, disabled: steps.nextKey === undefined },
    };
};

/**
 * A notice's sentence. Pure.
 *
 * @param notice - The notice.
 * @param copy - The localised copy.
 * @param locale - The active locale.
 * @returns The sentence.
 */
export const pasteMatchNoticeOf = (notice: PasteMatchNotice, copy: PasteCopy, locale: string): string => {
    switch (notice.kind) {
        case 'offline':
            return notice.keep === 'disk' ? copy.pasteMatch.offline.bodyDevice : copy.pasteMatch.offline.bodyTab;
        case 'quota':
            return quotaBodyOf(notice.resetsAt, copy, locale, notice.timeZone);
    }
};
