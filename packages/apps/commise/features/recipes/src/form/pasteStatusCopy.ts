/**
 * @module @commise/features-recipes/form — the WORDS and marks of a paste's statuses (UX spec, plan 2026-10-15-011),
 * worked out once for both platforms' leaves: each pasted row's state line and action, the progress block's title,
 * status and actions, and what the polite region says. The leaves only lay these out.
 *
 * ⛔ Nothing here moves: a working state takes a STATIC glyph. WCAG 2.2.2 exempts a loading animation only where nothing
 * can be done during the wait, and the editor stays usable through a read that can last minutes.
 *
 * Pure: copy and locale in, plain values out.
 *
 * @pattern Visitor — exhaustive switches over the row state, the progress status and the milestone
 */
import type { IconName } from '@commise/ui/icon';

import { pluralOf } from '../editor/messages.js';
import { fillTemplate } from '../format/fillTemplate.js';
import type { RecipeFormMessages } from './messages.js';
import type { PasteMilestone, PasteProgress, PasteRowState } from './props.js';

/** How a state line is marked: its glyph and whether it asks for attention. */
interface PasteMark {
    readonly icon: IconName;
    readonly tone: 'inkMuted' | 'attention';
}

/** What a pasted row draws under its text. */
export interface PasteRowView extends PasteMark {
    readonly stateText: string;
    /** The row's one action, if it has one. */
    readonly action: 'addAsWritten' | 'retryLookup' | undefined;
}

const WORKING: PasteMark = { icon: 'refreshCw', tone: 'inkMuted' };
const WAITING: PasteMark = { icon: 'clock', tone: 'inkMuted' };
const NEEDS_YOU: PasteMark = { icon: 'triangleAlert', tone: 'attention' };

/**
 * A pasted row's state line, mark and action.
 *
 * @param state - The row's state.
 * @param m - The form's copy.
 * @returns What the row draws. Pure.
 */
export function pasteRowViewOf(state: PasteRowState, m: RecipeFormMessages): PasteRowView {
    switch (state) {
        case 'queued':
            return { ...WAITING, stateText: m.rowStateQueued, action: undefined };
        case 'reading':
            return { ...WORKING, stateText: m.rowStateReading, action: undefined };
        case 'retrying':
            return { ...WORKING, stateText: m.rowStateRetrying, action: undefined };
        case 'delayed':
            return { ...WAITING, stateText: m.rowStateDelayed, action: undefined };
        case 'stalled':
            // ⛔ Never the alert mark: a stalled paste may still move, and it is not a failure.
            return { ...WAITING, stateText: m.rowStateStalled, action: 'addAsWritten' };
        case 'retryable':
            return { ...NEEDS_YOU, stateText: m.rowStateRetryable, action: 'addAsWritten' };
        case 'ready':
            return { icon: 'check', tone: 'inkMuted', stateText: m.rowStateJoinsInOrder, action: undefined };
        case 'joining':
            return { ...WORKING, stateText: m.rowStateLookingUp, action: undefined };
        case 'waiting':
            return { ...WAITING, stateText: m.rowStateWaitingForConnection, action: undefined };
        case 'lookupFailed':
            return { ...NEEDS_YOU, stateText: m.rowStateLookupFailed, action: 'retryLookup' };
    }
}

/** What the progress block draws. */
export interface PasteProgressView extends PasteMark {
    readonly title: string;
    readonly status: string;
    /** A second line under the status, for a stalled paste. */
    readonly hint: string | undefined;
    /** Try again's accessible name, when it is offered. */
    readonly retryLabel: string | undefined;
    /** Add the rest as written's accessible name, when it is offered (two lines or more). */
    readonly addRestLabel: string | undefined;
}

/** The status line and its mark. Pure. */
function statusOf(
    progress: PasteProgress,
    m: RecipeFormMessages,
    locale: string,
): PasteMark & { readonly status: string; readonly hint: string | undefined } {
    const { status } = progress;

    switch (status.kind) {
        case 'needsYou':
            return { ...NEEDS_YOU, status: pluralOf(m.pasteProgressNeedsYou, status.count, locale), hint: undefined };
        case 'offline':
            return { ...WAITING, status: m.pasteProgressOffline, hint: undefined };
        case 'stalled':
            return { ...WAITING, status: m.pasteProgressStalled, hint: m.pasteProgressStalledHint };

        case 'step': {
            const line = { line: String(status.position) };
            const template = {
                queued: m.pasteProgressQueued,
                reading: m.pasteProgressReading,
                retrying: m.pasteProgressRetrying,
                delayed: m.pasteProgressDelayed,
                joining: m.pasteProgressLookingUp,
            }[status.step];

            return {
                ...(status.step === 'queued' || status.step === 'delayed' ? WAITING : WORKING),
                status: fillTemplate(template, line),
                hint: undefined,
            };
        }
    }
}

/**
 * The progress block's words.
 *
 * @param progress - The block's model.
 * @param m - The form's copy.
 * @param locale - For the plural forms.
 * @returns What the block draws. Pure.
 */
export function pasteProgressViewOf(progress: PasteProgress, m: RecipeFormMessages, locale: string): PasteProgressView {
    return {
        title: fillTemplate(pluralOf(m.pasteProgressCount, progress.count, locale), { done: String(progress.done) }),
        ...statusOf(progress, m, locale),
        retryLabel: progress.retryCount > 0 ? pluralOf(m.pasteRetryAllLabel, progress.retryCount, locale) : undefined,
        addRestLabel:
            progress.restCount >= 2 ? pluralOf(m.pasteAddRestAsWrittenLabel, progress.restCount, locale) : undefined,
    };
}

/**
 * What the polite region says for a milestone.
 *
 * @param announcement - The milestone and the lines it is about.
 * @param m - The form's copy.
 * @param locale - For the plural forms.
 * @returns The words. Pure.
 */
export function pasteAnnouncementTextOf(
    announcement: { readonly milestone: PasteMilestone; readonly count: number },
    m: RecipeFormMessages,
    locale: string,
): string {
    switch (announcement.milestone) {
        case 'started':
            return pluralOf(m.pasteProgressStarted, announcement.count, locale);
        case 'needsYou':
            return pluralOf(m.pasteProgressNeedsYou, announcement.count, locale);
        case 'stalled':
            return `${m.pasteProgressStalled}. ${m.pasteProgressStalledHint}`;
        case 'resumed':
            return m.pasteProgressResumed;
        case 'offline':
            return m.pasteProgressOffline;
    }
}
