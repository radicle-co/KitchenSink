/**
 * @module @commise/features-recipes/editor — the in-memory overlay of ONE paste's matching: which of the job's foods have
 * joined the draft (and as which draft line), who bound each, and which line the list has open and the pane shows.
 *
 * ⛔ IT IS NOT PERSISTED. ADR-0057 makes the device-draft format a one-way door and the job is deliberately NOT recorded
 * in it, so this lives in the host's memory: a reload loses who-bound and the open line, and the draft keeps the lines
 * as the cook last saw them (ordinary rows). A line is overlay-owned only while its draft key is in this session.
 *
 * KEYS. Foods are keyed `${lineIndex}:${foodIndex}` (`foodKeyOf`), which repeat from job to job, so a new job STARTS A
 * CLEAN SESSION. Lines already in the draft from an earlier paste keep their text and become ordinary rows.
 *
 * Pure and platform-agnostic.
 *
 * @pattern State — the session is a value; every change is a command (event) applied by one reducer
 * @pattern Reducer — {@link reducePasteMatchSession}
 */
import type { LineBinding } from '../ingredientMatching/matchLine.js';

/** What happened to a food's place in the draft. A removed food is never joined again. */
export type JoinState =
    | { readonly status: 'joined'; readonly draftKey: string }
    | { readonly status: 'joinFailed' }
    | { readonly status: 'removed' };

/** One paste's overlay. */
export interface PasteMatchSession {
    /** The job this session belongs to, or `undefined` before one was accepted. */
    readonly jobId: string | undefined;
    /** Each food's place in the draft, by food key. A food with no entry has not been joined yet. */
    readonly joins: ReadonlyMap<string, JoinState>;
    /** Who bound each JOINED food, by food key. A food with no entry shows what the server derived. */
    readonly bindings: ReadonlyMap<string, LineBinding>;
    /** The line the list has open, or `undefined`. */
    readonly expanded: string | undefined;
    /** The line the pane (wide class) shows, or `undefined`. */
    readonly paneKey: string | undefined;
}

/** What can happen to the overlay. */
export type PasteMatchEvent =
    | { readonly type: 'jobAccepted'; readonly jobId: string }
    | { readonly type: 'lineJoined'; readonly key: string; readonly draftKey: string }
    | { readonly type: 'lineJoinFailed'; readonly key: string }
    | { readonly type: 'bindingSet'; readonly key: string; readonly binding: LineBinding }
    | { readonly type: 'draftLineRemoved'; readonly draftKey: string }
    | { readonly type: 'expanded'; readonly key: string | undefined }
    | { readonly type: 'paneMoved'; readonly key: string | undefined };

/** The session before any job. */
export const emptyPasteMatchSession: PasteMatchSession = {
    jobId: undefined,
    joins: new Map(),
    bindings: new Map(),
    expanded: undefined,
    paneKey: undefined,
};

/**
 * A food's place in the draft. Pure.
 *
 * @param session - The session.
 * @param key - The food's key.
 * @returns Its join state, or `undefined` when it has not been joined.
 */
export function joinStateOf(session: PasteMatchSession, key: string): JoinState | undefined {
    return session.joins.get(key);
}

/**
 * The draft line a food joined as. Pure.
 *
 * @param session - The session.
 * @param key - The food's key.
 * @returns The draft key, or `undefined` when the food is not in the draft.
 */
export function draftKeyOf(session: PasteMatchSession, key: string): string | undefined {
    const join = session.joins.get(key);

    return join?.status === 'joined' ? join.draftKey : undefined;
}

/** A copy of a map with one entry set. Pure. */
function withEntry<V>(map: ReadonlyMap<string, V>, key: string, value: V): ReadonlyMap<string, V> {
    return new Map(map).set(key, value);
}

/** Whether moving the open or pane line to `key` is a no-op: it is already there, or `key` is not in the draft. Pure. */
function isUnchangedFocus(session: PasteMatchSession, key: string | undefined, current: string | undefined): boolean {
    return key === current || (key !== undefined && draftKeyOf(session, key) === undefined);
}

/**
 * The session after an event. Returns `session` itself when the event changes nothing. Pure.
 *
 * @param session - The session now.
 * @param event - What happened.
 * @returns The new session.
 */
export function reducePasteMatchSession(session: PasteMatchSession, event: PasteMatchEvent): PasteMatchSession {
    switch (event.type) {
        case 'jobAccepted':
            return session.jobId === event.jobId ? session : { ...emptyPasteMatchSession, jobId: event.jobId };

        case 'lineJoined': {
            const status = session.joins.get(event.key)?.status;

            return status === undefined || status === 'joinFailed'
                ? {
                      ...session,
                      joins: withEntry(session.joins, event.key, { status: 'joined', draftKey: event.draftKey }),
                  }
                : session;
        }

        case 'lineJoinFailed':
            return session.joins.has(event.key)
                ? session
                : { ...session, joins: withEntry(session.joins, event.key, { status: 'joinFailed' }) };

        case 'bindingSet':
            return draftKeyOf(session, event.key) === undefined
                ? session
                : { ...session, bindings: withEntry(session.bindings, event.key, event.binding) };

        case 'draftLineRemoved': {
            const entry = [...session.joins].find(
                ([, join]) => join.status === 'joined' && join.draftKey === event.draftKey,
            );

            if (entry === undefined) {
                return session;
            }

            const [key] = entry;
            const bindings = new Map(session.bindings);

            bindings.delete(key);

            return {
                ...session,
                joins: withEntry(session.joins, key, { status: 'removed' }),
                bindings,
                expanded: session.expanded === key ? undefined : session.expanded,
                paneKey: session.paneKey === key ? undefined : session.paneKey,
            };
        }

        case 'expanded':
            return isUnchangedFocus(session, event.key, session.expanded)
                ? session
                : { ...session, expanded: event.key };

        case 'paneMoved':
            return isUnchangedFocus(session, event.key, session.paneKey) ? session : { ...session, paneKey: event.key };
    }
}
