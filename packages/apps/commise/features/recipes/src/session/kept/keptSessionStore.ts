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
    let subscribedExternal = false;

    const set = (next: Partial<StoreState>): void => {
        state = { ...state, ...next };
        listeners.forEach((listener) => listener());
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

    const persist = async (key: string, doc: KeptDocument): Promise<void> => {
        const outcome = await port.write(key, serializeKeptDocument(doc));

        if (!outcome.ok && !reportedWriteFailure) {
            reportedWriteFailure = true;
            deps.report(outcome.error);
        }
    };

    const hydrate = (subject: string, generation: number): Promise<void> => {
        const key = keptKeyFor(subject);

        return exclusive(key, async (locked) => {
            const parsed = parseKeptDocument(await port.read(key));

            if (state.generation !== generation) {
                return;
            }

            let doc = EMPTY_KEPT_DOCUMENT;

            if (parsed.kind === 'invalid' && locked) {
                await port.remove(key);
            } else if (parsed.kind === 'ok') {
                doc = parsed.doc;

                if (parsed.droppedTimerIds.length > 0) {
                    deps.report(new KeptTimersDroppedError(parsed.droppedTimerIds.length));
                }
            }

            const pruned = applyKeptCommand(doc, { type: 'prune' }, deps.now());

            if (pruned.kind === 'applied') {
                doc = pruned.doc;

                if (locked && state.generation === generation) {
                    await persist(key, doc);
                }
            }

            if (state.generation === generation) {
                set({ snapshot: { status: 'ready', doc } });
            }
        });
    };

    const removeKeys = async (keep: string | undefined): Promise<void> => {
        for (const key of await port.keys(KEPT_KEY_PREFIX)) {
            if (key !== keep) {
                await exclusive(key, () => port.remove(key));
            }
        }
    };

    const reread = async (): Promise<void> => {
        const { subject, generation, snapshot } = state;

        if (subject === undefined || snapshot.status !== 'ready') {
            return;
        }

        const parsed = parseKeptDocument(await port.read(keptKeyFor(subject)));

        if (parsed.kind === 'ok' && state.generation === generation && parsed.doc.rev !== snapshot.doc.rev) {
            set({ snapshot: { status: 'ready', doc: parsed.doc } });
        }
    };

    const clear = async (subject: string | undefined): Promise<void> => {
        hydrating = undefined;
        set({
            subject: undefined,
            generation: state.generation + 1,
            snapshot: subject === undefined ? { status: 'signedOut' } : { status: 'loading' },
        });

        if (subject !== undefined) {
            const key = keptKeyFor(subject);

            await exclusive(key, () => port.remove(key));
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
            // The stored document is the truth unless a failed write left memory ahead of it (KTD2).
            const stored = locked ? parseKeptDocument(await port.read(key)) : undefined;
            const memory = state.snapshot.status === 'ready' ? state.snapshot.doc : undefined;
            const storedDoc = stored?.kind === 'ok' ? stored.doc : undefined;
            const base =
                storedDoc !== undefined && (memory === undefined || storedDoc.rev >= memory.rev)
                    ? storedDoc
                    : (memory ?? EMPTY_KEPT_DOCUMENT);
            const outcome = applyKeptCommand(base, command, deps.now());

            if (outcome.kind !== 'applied' || state.generation !== generation) {
                return outcome.kind === 'applied' ? UNCHANGED : outcome;
            }

            if (locked) {
                await persist(key, outcome.doc);
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
