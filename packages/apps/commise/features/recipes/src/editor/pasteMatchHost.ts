/**
 * @module @commise/features-recipes/editor — the ONE state the paste Mediator keeps: the overlay (`pasteMatchSession`),
 * the match requests (`matchRequests`) and the send ledger (`sendLedger`), under one reducer (blueprint A2; ADR-0071
 * section 9).
 *
 * WHY ONE REDUCER. An answer lands after a network call, when the render that started it is gone. A rule that asks
 * "what is true now" from a closure asks stale state; a rule inside a reducer asks the state it is applied to. So the
 * rules that matter live here, as data:
 *
 * - **An answer for an earlier job is dropped.** Food keys (`lineIndex:foodIndex`) repeat from job to job, so a late
 *   answer for the old job would land on the new job's line. Every event that can arrive late carries its job.
 * - **A pick that saved binds the line as the COOK'S** and marks that it saved (`saved`, with the tag the press gave it),
 *   which the view reads to move focus.
 * - **An offer the server stops showing is withdrawn** (`offerWithdrawn`): the binding goes unless the cook made it, and
 *   the draft line is re-pointed back to the line as written.
 * - **A binding the REVIEW offers lands only on a line nobody has bound** (ADR-0071 section 9: a late verdict never
 *   replaces a pick the cook made), and only then is the draft line re-pointed (`rebinds`, applied by the host and then
 *   cleared). A pick the cook made first leaves both untouched.
 *
 * Pure and platform-agnostic.
 *
 * @pattern State — the host's memory is a value; every change is an event applied by one reducer
 * @pattern Reducer — {@link reducePasteMatchHost}, composing the three reducers it holds
 */
import type { LineBinding as DraftBinding } from '../form/lineBinding.js';
import type { LineBinding } from '../ingredientMatching/matchLine.js';
import {
    emptySendLedger,
    reduceSendLedger,
    type SendAttempt,
    type SendLedger,
    type SendLedgerEvent,
} from '../ingredientMatching/sendLedger.js';
import {
    emptyMatchRequests,
    reduceMatchRequests,
    type MatchRequestEvent,
    type MatchRequests,
} from './matchRequests.js';
import {
    emptyPasteMatchSession,
    reducePasteMatchSession,
    type PasteMatchEvent,
    type PasteMatchSession,
} from './pasteMatchSession.js';

/** The last pick that saved. */
export interface SavedPick {
    readonly key: string;
    /** What the press gave it (the container class it was made at), for the view's focus rule. */
    readonly tag: string | undefined;
    /** Moves at each save, so two picks on one line are two events. */
    readonly seq: number;
}

/** The host's state. */
export interface PasteMatchHost {
    /** The job the state belongs to, or `undefined` before one (and for a paste the daily limit refused). */
    readonly jobId: string | undefined;
    readonly session: PasteMatchSession;
    readonly requests: MatchRequests;
    readonly ledger: SendLedger;
    /** Draft re-points the review earned, by food key, waiting for the host to apply them (`rebindApplied`). */
    readonly rebinds: ReadonlyMap<string, DraftBinding>;
    readonly saved: SavedPick | undefined;
}

/** What happens to the host. Every event that can arrive late carries the job it was made for. */
export type PasteMatchHostEvent =
    /** A paste starts: a new job starts clean, the same job changes nothing. */
    | { readonly type: 'jobStarted'; readonly jobId: string | undefined }
    | { readonly type: 'overlay'; readonly jobId: string | undefined; readonly event: PasteMatchEvent }
    | { readonly type: 'requests'; readonly jobId: string | undefined; readonly event: MatchRequestEvent }
    | { readonly type: 'ledger'; readonly jobId: string | undefined; readonly event: SendLedgerEvent }
    /** A pick saved: the send is clear, the line is the cook's, and the save is marked. */
    | {
          readonly type: 'pickSaved';
          readonly jobId: string | undefined;
          readonly key: string;
          readonly attempt: SendAttempt;
          readonly tag: string | undefined;
      }
    /** The review's food was admitted: bind the line if nobody has, and re-point its draft line. */
    | {
          readonly type: 'reviewAdmitted';
          readonly jobId: string | undefined;
          readonly key: string;
          readonly binding: Exclude<LineBinding, { readonly boundBy: 'cook' }>;
          readonly draft: DraftBinding;
      }
    /** The server stopped showing the offered food: unbind the line unless the cook did, and re-point its draft line. */
    | {
          readonly type: 'offerWithdrawn';
          readonly jobId: string | undefined;
          readonly key: string;
          readonly draft: DraftBinding;
      }
    /** The host re-pointed the draft line. */
    | { readonly type: 'rebindApplied'; readonly key: string };

/** The host before any job. */
export const emptyPasteMatchHost: PasteMatchHost = {
    jobId: undefined,
    session: emptyPasteMatchSession,
    requests: emptyMatchRequests,
    ledger: emptySendLedger,
    rebinds: new Map(),
    saved: undefined,
};

/** The pick an attempt carries, as the line shows it. Pure. */
function linePickOf(attempt: SendAttempt): Extract<LineBinding, { boundBy: 'cook' }>['pick'] {
    return attempt.kind === 'pick'
        ? attempt.pick
        : { kind: 'food', foodId: attempt.food.foodId, name: attempt.food.name };
}

/** A paste starts: a new job starts clean, the same job changes nothing. Pure. */
function startJob(host: PasteMatchHost, jobId: string | undefined): PasteMatchHost {
    if (jobId === host.jobId) {
        return host;
    }

    return {
        ...emptyPasteMatchHost,
        jobId,
        session:
            jobId === undefined
                ? emptyPasteMatchSession
                : reducePasteMatchSession(emptyPasteMatchSession, { type: 'jobAccepted', jobId }),
    };
}

/** The host re-pointed a draft line: the waiting re-point for `key` is done. Pure. */
function applyRebind(host: PasteMatchHost, key: string): PasteMatchHost {
    if (!host.rebinds.has(key)) {
        return host;
    }

    const rebinds = new Map(host.rebinds);

    rebinds.delete(key);

    return { ...host, rebinds };
}

/**
 * The state after an event. Returns `host` itself when the event changes nothing. Pure.
 *
 * @param host - The state now.
 * @param event - What happened.
 * @returns The new state.
 */
export function reducePasteMatchHost(host: PasteMatchHost, event: PasteMatchHostEvent): PasteMatchHost {
    if (event.type === 'jobStarted') {
        return startJob(host, event.jobId);
    }

    if (event.type === 'rebindApplied') {
        return applyRebind(host, event.key);
    }

    if (event.jobId !== host.jobId) {
        return host;
    }

    switch (event.type) {
        case 'overlay': {
            const session = reducePasteMatchSession(host.session, event.event);

            return session === host.session ? host : { ...host, session };
        }

        case 'requests': {
            const requests = reduceMatchRequests(host.requests, event.event);

            return requests === host.requests ? host : { ...host, requests };
        }

        case 'ledger': {
            const ledger = reduceSendLedger(host.ledger, event.event);

            return ledger === host.ledger ? host : { ...host, ledger };
        }

        case 'pickSaved': {
            const session = reducePasteMatchSession(host.session, {
                type: 'bindingSet',
                key: event.key,
                binding: { boundBy: 'cook', pick: linePickOf(event.attempt), reviewNote: undefined },
            });

            return {
                ...host,
                session,
                ledger: reduceSendLedger(host.ledger, { type: 'saved', key: event.key }),
                saved: { key: event.key, tag: event.tag, seq: (host.saved?.seq ?? 0) + 1 },
            };
        }

        case 'offerWithdrawn': {
            const session = reducePasteMatchSession(host.session, { type: 'offerWithdrawn', key: event.key });

            return session === host.session
                ? host
                : { ...host, session, rebinds: new Map(host.rebinds).set(event.key, event.draft) };
        }

        case 'reviewAdmitted': {
            const session = reducePasteMatchSession(host.session, {
                type: 'bindingOffered',
                key: event.key,
                binding: event.binding,
            });
            const ledger = reduceSendLedger(host.ledger, { type: 'saved', key: event.key });
            // The draft is re-pointed only when the offer was TAKEN: a line the cook bound (or deleted) keeps its draft.
            const taken = session !== host.session;

            return {
                ...host,
                session,
                ledger,
                rebinds: taken ? new Map(host.rebinds).set(event.key, event.draft) : host.rebinds,
            };
        }
    }
}
