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
import { lineTextOf, type MatchCounts, type MatchLine } from '../ingredientMatching/matchLine.js';
import {
    openLineViewOf,
    type ListPlace,
    type MatchCopy,
    type OpenLineView,
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
    /** The non-zero counts, in the spec's order; `''` when every count is 0. */
    readonly counts: string;
    readonly rule: string;
}

/**
 * The summary above the pasted lines: how many were added, the non-zero counts in the spec's order, and the rule. Pure.
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
 * @param timeZone - The cook's IANA time zone, resolved by the host: passing it keeps this function pure.
 * @returns The notice's sentence.
 */
export const quotaBodyOf = (resetsAt: string, copy: PasteCopy, locale: string, timeZone: string): string =>
    fillTemplate(copy.pasteMatch.quota.body, {
        time: new Intl.DateTimeFormat(locale, { timeStyle: 'short', timeZone }).format(new Date(resetsAt)),
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
 * What the side pane shows for the open line it is on. Pure.
 *
 * @param line - The line.
 * @param place - Where it stands among the open lines.
 * @param list - Whether search can run, and the pick in flight.
 * @param copy - The paste flow's copy.
 * @param lineCopy - The matched line's copy.
 * @returns The pane's view.
 */
export const pasteMatchPaneViewOf = (
    line: MatchLine,
    place: PanePlace,
    list: ListPlace,
    copy: PasteCopy,
    lineCopy: MatchCopy,
): PasteMatchPaneView => {
    const pane = copy.pasteMatch.pane;

    return {
        label: pane.label,
        position: fillTemplate(pane.position, { n: place.index + 1, total: place.count }),
        heading: lineTextOf(line.line),
        open: openLineViewOf(line, list, lineCopy),
        previous: { label: pane.previous, disabled: place.index <= 0 },
        next: { label: pane.next, disabled: place.index >= place.count - 1 },
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
