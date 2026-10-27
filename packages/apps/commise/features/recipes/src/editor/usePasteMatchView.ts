'use client';

/**
 * @module @commise/features-recipes/editor — what the Ingredients section draws of the paste's MATCHED lines, composed
 * once for both platforms: the list and the side pane (`MatchLineList`, `PasteChoicePane`), the summary above them, the
 * notice when matching cannot run, and the focus rules around a pick (blueprint A2, host gap rules 1 and 3;
 * `docs/design/uiRefreshWorkshop5/redesignCanvas/ingredientMatching.md`).
 *
 * - **One retry memory** (`useRetryFocus`) over the list's and the pane's sends together. The host says where the cook
 *   is: every row handler, the pane's steps and the picker opening call `noteAttention(key)` first, so a Try again that
 *   finishes after the cook left the line takes no focus, and the host's own move after a pick runs only for a line the
 *   cook is still on (`ownsFocus`).
 * - **Focus after a pick** follows `pickFocusOf`: below the wide class the next open line opens and takes focus; with
 *   none left the summary takes it. At the wide class the pane stays on the line: Next moves on.
 * - **One polite region** says what changed under the cook (`lineChangesOf`) and the reason "See why" asks for.
 * - **The container class picks the layout**, not this hook: `layoutFor(wide)` builds both from the same state.
 *
 * @pattern Presentation Model — the paste list's props and rules derived once for both platform leaves
 * @pattern Memento — the retry memory and the last announced snapshot, kept as state adjusted during render
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { useState } from 'react';

import type { PasteMatchingView, PasteMatchLayout } from '../form/props.js';
import { recipeFormMessages } from '../form/messages.js';
import { paneStepsOf, pasteMatchNoticeFor, pasteMatchPaneViewOf, pasteMatchSummaryOf } from '../form/pasteMatchView.js';
import { lineChangesOf, type ListSnapshot } from '../ingredientMatching/lineAnnouncement.js';
import {
    matchCountsOf,
    nextOpenLineKey,
    pickFocusOf,
    type LinePick,
    type MatchLine,
} from '../ingredientMatching/matchLine.js';
import type { MatchLineListProps } from '../ingredientMatching/matchLineListProps.js';
import { sendStateOf } from '../ingredientMatching/matchLineView.js';
import { useMatchCopy } from '../ingredientMatching/useMatchCopy.js';
import { useRetryFocus } from '../ingredientMatching/useRetryFocus.js';
import { openChoiceFactsOf } from './pasteOpenChoices.js';
import type { OpenChoicesFacts } from './openChoicesCopy.js';
import type { DraftKeep } from './saveStatus.js';
import type { PasteQuota } from './usePasteIntoIngredients.js';
import type { PasteMatching } from './usePasteMatching.js';

/** Options for {@link usePasteMatchView}. */
export interface UsePasteMatchViewOptions {
    readonly matching: PasteMatching;
    /** Every ingredient line of the draft, the paste's included. */
    readonly lineCount: number;
    /** Where the draft is kept (D7), for the offline notice. */
    readonly keep: DraftKeep;
    /** The daily limit's refusal, if the last paste met it. */
    readonly quota: PasteQuota | undefined;
    /** Work is waiting for a connection. */
    readonly offline: boolean;
}

/** What the section and the publish action read. */
export interface PasteMatchPresentation {
    readonly view: PasteMatchingView;
    /** The publish sheet's facts, or `undefined` while no line needs a pick (Publish goes straight through). */
    readonly facts: OpenChoicesFacts | undefined;
    /** Choose now: open the first line that needs a pick, and ask it for focus. */
    readonly chooseNow: () => void;
}

/** The tag a press at the wide class gives its pick: the pane stays on the line, so no focus moves on. */
const WIDE = 'wide';

/** The tag a press gives its pick, by the container class it was made at. Pure. */
const tagOf = (wide: boolean): string => (wide ? WIDE : 'narrow');

/** What the list's one polite region says now. */
interface Speech {
    readonly text: string;
    readonly occurrence: number;
}

/** What a list's announcement is derived from, as a string: equal strings mean nothing worth saying changed. Pure. */
function signatureOf(lines: readonly MatchLine[], failed: ReadonlySet<string>): string {
    return [
        ...lines.map((line) => {
            const binding = line.binding;
            const note = binding?.boundBy === 'cook' ? (binding.reviewNote?.suggestedFood ?? '') : '';
            const pick = binding === undefined ? '' : binding.pick.kind === 'food' ? binding.pick.foodId : 'asWritten';

            return `${line.key}|${line.state}|${binding?.boundBy ?? ''}|${pick}|${note}`;
        }),
        [...failed].sort().join(','),
    ].join(';');
}

/**
 * The paste's matched lines, the summary, the notice and the rules around a pick, for both platforms.
 *
 * @param options - The Mediator's state and what the notice and counts need.
 * @returns The section's view and the publish sheet's facts.
 * @sideEffect Updates its own state during render when the announced snapshot moves.
 */
export function usePasteMatchView(options: UsePasteMatchViewOptions): PasteMatchPresentation {
    const { matching } = options;
    const m = useMessages(recipeFormMessages);
    const locale = useLocale();
    const copy = useMatchCopy();
    const lines = matching.drawn;
    const sending = { has: (key: string) => matching.pending.has(key) };
    const retryOf = useRetryFocus(
        lines.map((line) =>
            sendStateOf(line.key, { failed: matching.failed.has(line.key), pending: matching.pending.get(line.key) }),
        ),
    );
    const [focusRequested, setFocusRequested] = useState(false);
    const [summaryFocusSignal, setSummaryFocusSignal] = useState(0);

    // What the list says, politely, when its lines change under the cook; and the reason "See why" asks for.
    const signature = signatureOf(lines, matching.failed);
    const [announced, setAnnounced] = useState<{ signature: string; snapshot: ListSnapshot }>(() => ({
        signature,
        snapshot: { lines, failed: matching.failed },
    }));
    const [speech, setSpeech] = useState<Speech>({ text: '', occurrence: 0 });

    if (announced.signature !== signature) {
        const text = lineChangesOf(announced.snapshot, { lines, failed: matching.failed }, copy);

        setAnnounced({ signature, snapshot: { lines, failed: matching.failed } });

        if (text !== '') {
            setSpeech({ text, occurrence: speech.occurrence + 1 });
        }
    }

    // The line a list opens by default and Choose now opens: the first that needs a pick, a send in flight or not (a line
    // must not collapse under the press that picked its food).
    const firstOpenKey = nextOpenLineKey(lines, undefined, { has: () => false });
    const known = (key: string | undefined): string | undefined =>
        key !== undefined && lines.some((line) => line.key === key) ? key : undefined;
    const expandedKey = known(matching.session.expanded) ?? firstOpenKey;
    const paneKey = known(matching.session.paneKey) ?? firstOpenKey;

    // After a pick saved: the next open line below the wide class, else the summary; at the wide class the pane stays on the
    // line (Next moves on). Only for a line the cook is still on. Adjusted during render from the Mediator's own mark, so it
    // reads the lines as they stand now, not as they stood at the press.
    const [seenSave, setSeenSave] = useState(matching.saved);

    if (matching.saved !== seenSave) {
        setSeenSave(matching.saved);
        const save = matching.saved;

        if (save !== undefined && save.tag !== WIDE && retryOf.ownsFocus(save.key)) {
            const next = pickFocusOf(lines, save.key, sending);

            if (next.kind === 'line') {
                matching.expandTo(next.key);
                setFocusRequested(true);
            } else {
                matching.expandTo(undefined);
                setSummaryFocusSignal((signal) => signal + 1);
            }
        }
    }

    const handlersFor = (wide: boolean): Omit<MatchLineListProps, keyof MatchLineListState> => ({
        onOpen: (key) => {
            retryOf.noteAttention(key);

            if (wide) {
                matching.moveTo(key);
            } else {
                matching.expandTo(key);
            }
        },
        onPick: (key, pick: LinePick) => {
            retryOf.noteAttention(key);
            matching.pick(key, pick, tagOf(wide));
        },
        onSearch: (key) => {
            retryOf.noteAttention(key);
            matching.search(key);
        },
        onUseProposal: (key) => {
            retryOf.noteAttention(key);
            matching.useProposal(key, tagOf(wide));
        },
        onRetry: (key) => {
            retryOf.noteAttention(key);
            matching.retryOptions(key);
        },
        onRetryPick: (key) => {
            retryOf.noteAttention(key);
            matching.retryPick(key, tagOf(wide));
        },
        onSeeWhy: (key, reason) => {
            retryOf.noteAttention(key);
            setSpeech((current) => ({ text: reason, occurrence: current.occurrence + 1 }));
        },
    });

    const focus = { requested: focusRequested, onHandled: () => setFocusRequested(false) };

    const layoutFor = (wide: boolean): PasteMatchLayout | undefined => {
        if (lines.length === 0) {
            return undefined;
        }

        const handlers = handlersFor(wide);
        const list: MatchLineListProps = {
            ...handlers,
            lines,
            expandedKey: wide ? undefined : expandedKey,
            currentKey: wide ? paneKey : undefined,
            online: !options.offline,
            pending: matching.pending,
            failed: matching.failed,
            announcement: speech,
            focus,
            retryFocus: retryOf,
        };

        if (!wide || paneKey === undefined) {
            return { list, pane: undefined };
        }

        const place = { lines, shownKey: paneKey, sending };
        const steps = paneStepsOf(place);

        const step = (to: string | undefined): void => {
            if (to !== undefined) {
                retryOf.noteAttention(to);
                matching.moveTo(to);
            }
        };

        return {
            list,
            pane: {
                view: pasteMatchPaneViewOf(
                    place,
                    {
                        online: !options.offline,
                        pending: matching.pending.get(paneKey),
                        failed: matching.failed.has(paneKey),
                    },
                    m,
                    copy,
                ),
                onSearch: () => handlers.onSearch(paneKey),
                onPick: (pick) => handlers.onPick(paneKey, pick),
                focus,
                onPrevious: () => step(steps.previousKey),
                onNext: () => step(steps.nextKey),
                onRetryPick: () => handlers.onRetryPick(paneKey),
                onSeeWhy: (reason) => handlers.onSeeWhy(paneKey, reason),
                retry: retryOf(paneKey),
            },
        };
    };

    const notice = pasteMatchNoticeFor({
        quota: options.quota,
        offline: options.offline,
        keep: options.keep,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        lines: matching.lines,
    });

    return {
        view: {
            ownedKeys: matching.ownedKeys,
            summary:
                matching.lines.length === 0
                    ? undefined
                    : pasteMatchSummaryOf(
                          { added: matching.lines.length, ...matchCountsOf(matching.lines) },
                          m,
                          locale,
                      ),
            summaryFocusSignal,
            notice,
            layoutFor,
        },
        facts: openChoiceFactsOf(matching.lines, options.lineCount),
        chooseNow: () => {
            if (firstOpenKey === undefined) {
                return;
            }

            retryOf.noteAttention(firstOpenKey);
            matching.expandTo(firstOpenKey);
            matching.moveTo(firstOpenKey);
            setFocusRequested(true);
        },
    };
}

/** The list's props that are state rather than handlers. */
type MatchLineListState = Pick<
    MatchLineListProps,
    'lines' | 'expandedKey' | 'currentKey' | 'online' | 'pending' | 'failed' | 'announcement' | 'focus' | 'retryFocus'
>;
