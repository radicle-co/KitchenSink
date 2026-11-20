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
import { fillTemplate, pluralOf } from '@commise/i18n';

import type { DraftKeep } from '../editor/saveStatus.js';
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
    | { readonly kind: 'quota'; readonly resetsAt: string; readonly now: string; readonly timeZone: string }
    /** The month's AI check is used up (owner design 2026-10-26): the foods were matched without it, until `resetsAt`. */
    | { readonly kind: 'noAiCheck'; readonly resetsAt: string };

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

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The calendar days from `from` to `to` in `timeZone`: 0 the same day, 1 the next. Whole days by the cook's own calendar, so
 * a reset 23 hours away can still be "tomorrow", and 11 PM in New York is not already the next UTC day. Pure.
 *
 * @param from - The earlier instant.
 * @param to - The later instant.
 * @param timeZone - The cook's IANA time zone.
 * @returns The day difference; negative when `to` is on an earlier day.
 */
const calendarDaysBetween = (from: Date, to: Date, timeZone: string): number => {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' });

    // The numeric parts, read back with `Date.UTC`, are a plain calendar day with no zone or DST in it. No formatted date
    // string is parsed, so the count does not depend on how a device's date library writes a date.
    // ⛔ An engine whose Intl cannot read the parts in a zone (Hermes without full ICU) yields no numbers. The device's own
    // calendar is then the fallback: the zone passed in is the device's, so it is the cook's day too.
    const dayStartOf = (instant: Date): number => {
        const part = (type: Intl.DateTimeFormatPartTypes): number =>
            Number(parts.formatToParts(instant).find((entry) => entry.type === type)?.value);
        const zoned = Date.UTC(part('year'), part('month') - 1, part('day'));

        return Number.isFinite(zoned) ? zoned : Date.UTC(instant.getFullYear(), instant.getMonth(), instant.getDate());
    };

    return Math.round((dayStartOf(to) - dayStartOf(from)) / MS_PER_DAY);
};

/**
 * The daily limit's notice (004 FR-022), with when matching starts again in the cook's locale: the time alone when it is later
 * today, and "tomorrow at <time>" on a later day. The reset is at most a rolling day away, so it falls today or tomorrow; a
 * reset further off comes only from a device clock that is behind, and it still reads as tomorrow. Pure.
 *
 * @param resetsAt - When the limit resets, ISO 8601 (the refusal's `resetsAt`).
 * @param now - The instant the notice is read at, ISO 8601: passing it keeps this function pure.
 * @param copy - The localised copy.
 * @param locale - The active locale.
 * @param timeZone - The cook's IANA time zone, resolved by the host: passing it keeps this function pure.
 * @returns The notice's sentence.
 */
export const quotaBodyOf = (
    resetsAt: string,
    now: string,
    copy: PasteCopy,
    locale: string,
    timeZone: string,
): string => {
    const reset = new Date(resetsAt);
    const time = new Intl.DateTimeFormat(locale, { timeStyle: 'short', timeZone }).format(reset);
    const days = calendarDaysBetween(new Date(now), reset, timeZone);

    if (days <= 0) {
        return fillTemplate(copy.pasteMatch.quota.today, { time });
    }

    return fillTemplate(copy.pasteMatch.quota.tomorrow, { time });
};

/**
 * The notice for foods matched without the AI check (board ImportPasteNoAiCheck), with the day it comes back as a day and
 * month in the cook's locale. Pure.
 *
 * ⛔ The date is read in UTC. `reviewResetsAt` is the first of next month at 00:00 UTC (the spend period's end,
 * ADR-0024), so a cook west of UTC would read "31 October" from their own zone and be told the check returns before the
 * period ends.
 *
 * @param resetsAt - When the check comes back, ISO 8601 (`reviewResetsAt`).
 * @param copy - The localised copy.
 * @param locale - The active locale (en-GB reads "1 November", en-US "November 1").
 * @returns The notice's sentence.
 */
export const noAiCheckBodyOf = (resetsAt: string, copy: PasteCopy, locale: string): string =>
    fillTemplate(copy.pasteMatch.noAiCheck.body, {
        date: new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(
            new Date(resetsAt),
        ),
    });

/** What {@link pasteMatchNoticeFor} chooses from. */
export interface PasteMatchNoticeInput {
    /** The daily limit's refusal, if the last paste met it. */
    readonly quota: { readonly resetsAt: string } | undefined;
    /** Work is waiting for a connection. */
    readonly offline: boolean;
    /** Where the draft is kept (D7), for the offline notice. */
    readonly keep: DraftKeep;
    /** The cook's IANA time zone, for the daily limit's time. */
    readonly timeZone: string;
    /** The instant the notice is read at, ISO 8601, so the daily limit can say which day it resets on. */
    readonly now: string;
    /** The paste's matched lines. */
    readonly lines: readonly MatchLine[];
}

/**
 * The ONE notice above the pasted lines, or none. It is a polite status, so one fact is said at a time, in this order:
 * the daily limit (nothing was matched), being offline (the check waits), then the spent AI budget (the foods were matched
 * without the check). A spent budget with no date from the server says nothing here; each such line still says so under
 * its own See why. Pure.
 *
 * @param input - The facts.
 * @returns The notice, or `undefined`.
 */
export const pasteMatchNoticeFor = (input: PasteMatchNoticeInput): PasteMatchNotice | undefined => {
    if (input.quota !== undefined) {
        return { kind: 'quota', resetsAt: input.quota.resetsAt, now: input.now, timeZone: input.timeZone };
    }

    if (input.offline && input.lines.length > 0) {
        return { kind: 'offline', keep: input.keep };
    }

    const resetsAt = input.lines
        .map((line) => (line.state === 'needsChoice' ? line.budgetSpent?.resetsAt : undefined))
        .find((at): at is string => at !== undefined);

    return resetsAt === undefined ? undefined : { kind: 'noAiCheck', resetsAt };
};

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
            return quotaBodyOf(notice.resetsAt, notice.now, copy, locale, notice.timeZone);
        case 'noAiCheck':
            return noAiCheckBodyOf(notice.resetsAt, copy, locale);
    }
};
