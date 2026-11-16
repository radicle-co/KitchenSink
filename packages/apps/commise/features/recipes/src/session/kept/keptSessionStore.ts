/**
 * @module The kept store (plan 0003 KTD2 to KTD5, blueprint S57): reads and writes the kept record through a port,
 * one exclusive section per write, and hands React a stable snapshot. Every rule over the record is in
 * {@link applyKeptCommand}; this module only orders reads and writes safely.
 *
 * @pattern Observer — `subscribe` and `getSnapshot` are the `useSyncExternalStore` contract.
 * @pattern Unit of Work — each dispatch re-reads, applies one command and writes once, inside the lock.
 */
import type { ErrorReporter } from '@commise/features-core';

import { applyKeptCommand, type KeptCommand, type KeptOutcome } from './keptCommands.js';
import { KeptTimersDroppedError } from './keptErrors.js';
import type { ExclusiveRunner, KeptPort } from './keptPort.js';
import {
    EMPTY_KEPT_DOCUMENT,
    KEPT_KEY_PREFIX,
    keptKeyFor,
    parseKeptDocument,
    serializeKeptDocument,
    type KeptDocument,
} from './keptRecord.js';

export type KeptSnapshot =
    /** No subject: readers show no session and nothing is written. */
    | { readonly status: 'signedOut' }
    /** Hydrating: readers are held (R2a, KTD2). */
    | { readonly status: 'loading' }
    | { readonly status: 'ready'; readonly doc: KeptDocument };

export interface KeptSessionStore {
    /** Stable identity between changes; never writes. */
    getSnapshot(): KeptSnapshot;
    subscribe(listener: () => void): () => void;
    /** `undefined` is loading, `null` is signed out, a string is the cook (KTD4). */
    scope(subject: string | null | undefined): Promise<void>;
    dispatch(command: KeptCommand): Promise<KeptOutcome>;
    /** Ends this device's record for `subject` through the store's own writer (KTD3). */
    clear(subject: string | undefined): Promise<void>;
    /** Reads the stored record and notifies if it changed; never writes. */
    reread(): Promise<void>;
}

export interface KeptSessionStoreDeps {
    readonly port: KeptPort;
    /** Read at each call: `undefined` where no exclusion exists (web without Web Locks). */
    readonly exclusiveOf: () => ExclusiveRunner | undefined;
    readonly now: () => string;
    readonly report: ErrorReporter;
    readonly warn: (message: string) => void;
}

interface StoreState {
    readonly subject: string | undefined;
    /** Bumped by `clear` and by every change of subject; a queued operation holding an older one is dropped (KTD3). */
    readonly generation: number;
    readonly snapshot: KeptSnapshot;
}

const UNCHANGED: KeptOutcome = { kind: 'unchanged' };

/**
 * Creates the store.
 *
 * @param deps - The port, the lock, the clock and the reporting seams.
 * @returns The store.
 * @sideEffect The returned store reads and writes the port, and reports through `report`.
 */
export function createKeptSessionStore(deps: KeptSessionStoreDeps): KeptSessionStore {
    const { port } = deps;
    const listeners = new Set<() => void>();
    let state: StoreState = { subject: undefined, generation: 0, snapshot: { status: 'loading' } };
    let hydrating: Promise<void> | undefined;
    let warnedNoLocks = false;
    let reportedWriteFailure = false;
    let reportedPortFailure = false;
    let subscribedExternal = false;
    /** After a failed write only: the document memory holds, valid while storage still holds `fromRev` (KTD2). */
    let pending: { readonly fromRev: number; readonly doc: KeptDocument } | undefined;
    /**
     * Commands applied in memory while storage could not be read (so nothing was written), each with the instant the
     * cook made it: a pause or a last-touch replayed later must keep the time the cook acted, not the replay time. The next successful locked
     * dispatch replays them on top of what storage then holds, so a change made during a transient failure is not lost
     * (KTD5). Dropped on sign-out and on a change of cook, so it never reaches another record.
     */
    let unsaved: readonly { readonly command: KeptCommand; readonly at: string }[] = [];
    /** The last raw string this store read or wrote, so a re-read can tell a different record from the same one. */
    let lastRaw: string | null | undefined;

    const set = (next: Partial<StoreState>): void => {
        state = { ...state, ...next };
        listeners.forEach((listener) => listener());
    };

    /**
     * Runs one read, remove or keys call. Storage can throw (blocked cookies make `localStorage` throw a
     * SecurityError; AsyncStorage can reject): that is reported once and answered as `ok: false`, so the caller treats
     * the record as unreadable and never writes over it. Nothing here wedges `hydrating`.
     */
    const attempt = async <T>(work: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> => {
        try {
            return { ok: true, value: await work() };
        } catch (error) {
            if (!reportedPortFailure) {
                reportedPortFailure = true;
                deps.report(error);
            }

            return { ok: false };
        }
    };

    /** Runs `work` in the exclusive section for `name`; with no locks it runs bare and warns once. */
    const exclusive = <T>(name: string, work: (locked: boolean) => Promise<T>): Promise<T> => {
        const run = deps.exclusiveOf();

        if (run === undefined) {
            if (!warnedNoLocks) {
                warnedNoLocks = true;
                deps.warn('Web Locks are not available: the kept session lives in memory only.');
            }

            return work(false);
        }

        return run(name, () => work(true));
    };

    const persist = async (key: string, doc: KeptDocument, fromRev: number): Promise<void> => {
        const raw = serializeKeptDocument(doc);
        const outcome = await port.write(key, raw);

        if (outcome.ok) {
            pending = undefined;
            lastRaw = raw;

            return;
        }

        pending = { fromRev, doc };

        if (!reportedWriteFailure) {
            reportedWriteFailure = true;
            deps.report(outcome.error);
        }
    };

    const hydrate = (subject: string, generation: number): Promise<void> => {
        const key = keptKeyFor(subject);

        return exclusive(key, async (locked) => {
            const read = await attempt(() => port.read(key));
            const raw = read.ok ? read.value : null;
            const writable = locked && read.ok;
            const parsed = parseKeptDocument(raw);

            if (state.generation !== generation) {
                return;
            }

            lastRaw = read.ok ? raw : undefined;

            let doc = EMPTY_KEPT_DOCUMENT;

            if (parsed.kind === 'invalid' && writable) {
                await attempt(() => port.remove(key));
            } else if (parsed.kind === 'ok') {
                doc = parsed.doc;

                if (parsed.droppedTimerIds.length > 0) {
                    deps.report(new KeptTimersDroppedError(parsed.droppedTimerIds.length));
                }
            }

            const pruned = applyKeptCommand(doc, { type: 'prune' }, deps.now());

            if (pruned.kind === 'applied') {
                doc = pruned.doc;

                if (writable && state.generation === generation) {
                    await persist(key, doc, parsed.kind === 'ok' ? parsed.doc.rev : 0);
                }
            }

            if (state.generation === generation) {
                set({ snapshot: { status: 'ready', doc } });
            }
        });
    };

    const removeKeys = async (keep: string | undefined): Promise<void> => {
        const listed = await attempt(() => port.keys(KEPT_KEY_PREFIX));

        for (const key of listed.ok ? listed.value : []) {
            if (key !== keep) {
                await exclusive(key, () => attempt(() => port.remove(key)));
            }
        }
    };

    const reread = async (): Promise<void> => {
        const { subject, generation, snapshot } = state;

        if (subject === undefined || snapshot.status !== 'ready') {
            return;
        }

        const read = await attempt(() => port.read(keptKeyFor(subject)));

        if (!read.ok || state.generation !== generation || read.value === lastRaw) {
            return;
        }

        const raw = read.value;

        const parsed = parseKeptDocument(raw);

        // An absent key is a cleared record; an unreadable one is left for the next locked write to replace.
        if (parsed.kind !== 'invalid') {
            lastRaw = raw;
            set({ snapshot: { status: 'ready', doc: parsed.kind === 'ok' ? parsed.doc : EMPTY_KEPT_DOCUMENT } });
        }
    };

    /** The document after each earlier unsaved command that still applies to it, in the order they were made. */
    const replay = (doc: KeptDocument, commands: typeof unsaved): KeptDocument =>
        commands.reduce((acc, { command, at }) => {
            const next = applyKeptCommand(acc, command, at);

            return next.kind === 'applied' ? next.doc : acc;
        }, doc);

    const clear = async (subject: string | undefined): Promise<void> => {
        // Clearing another cook (a switch of cook ends the old one's session) must not reset the cook now scoped.
        if (subject === undefined || subject === state.subject || state.subject === undefined) {
            hydrating = undefined;
            pending = undefined;
            unsaved = [];
            lastRaw = undefined;
            set({
                subject: undefined,
                generation: state.generation + 1,
                snapshot: subject === undefined ? { status: 'signedOut' } : { status: 'loading' },
            });
        }

        if (subject !== undefined) {
            const key = keptKeyFor(subject);

            await exclusive(key, () => attempt(() => port.remove(key)));
        }
    };

    const scope = async (subject: string | null | undefined): Promise<void> => {
        if (subject === undefined) {
            return;
        }

        if (subject === null) {
            await clear(state.subject);
            set({ snapshot: { status: 'signedOut' } });
            await removeKeys(undefined);

            return;
        }

        if (subject === state.subject) {
            await hydrating;

            return;
        }

        if (!subscribedExternal) {
            subscribedExternal = true;
            port.subscribeExternal?.(() => void reread());
        }

        const generation = state.generation + 1;

        pending = undefined;
        unsaved = [];
        lastRaw = undefined;
        set({ subject, generation, snapshot: { status: 'loading' } });
        // Assigned before the first await, so a dispatch made while the cook loads waits for it.
        hydrating = removeKeys(keptKeyFor(subject)).then(() => hydrate(subject, generation));
        await hydrating;
    };

    const dispatch = async (command: KeptCommand): Promise<KeptOutcome> => {
        await hydrating;

        const { subject, generation, snapshot } = state;

        if (subject === undefined || snapshot.status !== 'ready') {
            return UNCHANGED;
        }

        const key = keptKeyFor(subject);

        return exclusive(key, async (locked) => {
            // Storage is the truth. The one exception: our own write failed and nobody has written since, so storage
            // still holds the rev it held then (an absent or unreadable key is rev 0, and every real record is 1 or
            // more). Otherwise an absent key means empty, never memory, or a record another tab cleared would come back
            // (KTD3).
            const read = locked ? await attempt(() => port.read(key)) : undefined;
            const writable = read?.ok === true;
            const stored = read?.ok === true ? parseKeptDocument(read.value) : undefined;
            const storedDoc = stored?.kind === 'ok' ? stored.doc : EMPTY_KEPT_DOCUMENT;
            const held = pending;
            const useHeld = held !== undefined && storedDoc.rev === held.fromRev;
            const memory = state.snapshot.status === 'ready' ? state.snapshot.doc : EMPTY_KEPT_DOCUMENT;
            const stable = stored === undefined ? memory : useHeld ? held.doc : storedDoc;
            const base = writable ? replay(stable, unsaved) : stable;

            if (stored !== undefined && !useHeld) {
                pending = undefined;
            }

            const at = deps.now();
            const outcome = applyKeptCommand(base, command, at);

            if (outcome.kind !== 'applied' || state.generation !== generation) {
                return outcome.kind === 'applied' ? UNCHANGED : outcome;
            }

            if (writable) {
                unsaved = [];
                await persist(key, outcome.doc, storedDoc.rev);
            } else if (locked) {
                unsaved = [...unsaved, { command, at }];
            }

            if (state.generation === generation) {
                set({ snapshot: { status: 'ready', doc: outcome.doc } });
            }

            return outcome;
        });
    };

    return {
        getSnapshot: () => state.snapshot,
        subscribe: (listener) => {
            listeners.add(listener);

            return () => listeners.delete(listener);
        },
        scope,
        dispatch,
        clear,
        reread,
    };
}
