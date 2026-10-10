/**
 * @module @kitchensink/sync — the outbox mutator: the ONE writer of a user's outbox.
 *
 * ⛔ THE CURE FOR THE CLOBBER. The provider's drain used to write back the snapshot it had LOADED, so a record a
 * concurrent `submit` appended in between was lost from storage while the UI still counted it. Here every change is a
 * pure function of the log, and each one runs alone, against the log the store holds at that moment:
 *
 * - `mutate` calls are queued and run one at a time, in call order;
 * - each re-reads the store, applies its function, writes, and only then resolves;
 * - React state is a projection of what `subscribe` reports, never a second copy anyone writes back.
 *
 * Network sends happen OUTSIDE it: the drain reads a snapshot, sends, and reports each outcome as a small change
 * addressed by the record's sequence number (`settle`). Holding the queue across a request would make every `submit`
 * wait for the network, which is the one thing offline must not do.
 *
 * ⛔ THE FIRST READ OF A PROCESS DOES TWO THINGS, ONCE. It moves unreadable bytes to the quarantine key before anything
 * can overwrite them, and it parks every record a dead process left `sending` (`recoverInterrupted`), because that
 * request's outcome is unknown — and, when the store says its contents may be a copy another live owner holds (a
 * duplicated browser tab, `OutboxStore.isCopy`), every queued create as well.
 *
 * ⛔ THE SESSION-END CLEAR IS ONE MORE CHANGE IN THE SAME QUEUE (`clear`). A raw `removeItem` beside the queue lost to a
 * change already queued, which then wrote the old cook's journal back. And a change that leaves no records is never
 * written over an absent key: a drain's answer that lands after the clear has nothing to keep, and writing it would
 * bring the cleared key back.
 *
 * See ADR-0057 for the format it writes and the rules it keeps.
 *
 * @pattern Serialized Mutator (a single-writer Monitor over the store) — the store is the authority, this is its only
 *     writer, and the subscribers are Observers of what it wrote.
 */
import { recoverInterrupted, type OutboxLog } from './outboxLog.js';
import { parseOutbox, quarantineKeyFor, saveOutbox, storeKeyFor, type OutboxStore } from './outboxStore.js';
import { appendToQuarantine } from './quarantine.js';
import { createSerialQueue } from './serialQueue.js';

/** A user's outbox, changed only through here. */
export interface OutboxMutator {
    /** The log as stored now, after every change asked for before this call. */
    readonly read: () => Promise<OutboxLog>;
    /**
     * Apply `change` to the log as stored now, write the result, and resolve with it.
     *
     * Rejects when the store cannot be read or written; the stored log is then unchanged, and later changes still run.
     */
    readonly mutate: (change: (log: OutboxLog) => OutboxLog) => Promise<OutboxLog>;
    /** Be told the log after every successful change. Returns the unsubscribe. */
    readonly subscribe: (listener: (log: OutboxLog) => void) => () => void;
    /**
     * Remove the outbox and its quarantine: the session-end clear (ADR-0054, ADR-0057). Runs after every change asked
     * for before it. The mutator keeps working: the next change starts a new outbox for the subject.
     */
    readonly clear: () => Promise<void>;
}

/**
 * The mutator for one user's outbox.
 *
 * @param store - The platform adapter.
 * @param subject - The IdP subject that namespaces the outbox.
 * @returns The mutator. @sideEffect Its methods read and write `store`.
 */
export function createOutboxMutator(store: OutboxStore, subject: string): OutboxMutator {
    const listeners = new Set<(log: OutboxLog) => void>();
    const serialized = createSerialQueue();
    let opened = false;

    /** Read the stored log and whether the key exists; on the first successful read, quarantine and recover first. */
    const load = async (): Promise<{ readonly log: OutboxLog; readonly stored: boolean }> => {
        const raw = await store.getItem(storeKeyFor(subject));
        const loaded = parseOutbox(raw);
        const { quarantined: _count, ...log } = loaded;

        if (opened) {
            return { log, stored: raw !== null };
        }

        if (loaded.quarantined > 0 && raw !== null) {
            // Set aside, then the key starts empty, so a second process start cannot quarantine the same bytes twice.
            await appendToQuarantine(store, quarantineKeyFor(subject), raw);
            await store.removeItem(storeKeyFor(subject));
        }

        const recovered = recoverInterrupted(log, { copied: (await store.isCopy?.()) ?? false });

        if (recovered.records.some((record, at) => record !== log.records[at])) {
            await saveOutbox(store, subject, recovered);
        }

        opened = true;

        return { log: recovered, stored: raw !== null && loaded.quarantined === 0 };
    };

    return {
        read: () => serialized(async () => (await load()).log),
        mutate: (change) =>
            serialized(async () => {
                const { log, stored } = await load();
                const next = change(log);

                if (stored || next.records.length > 0) {
                    await saveOutbox(store, subject, next);
                }

                for (const listener of listeners) {
                    listener(next);
                }

                return next;
            }),
        subscribe: (listener) => {
            listeners.add(listener);

            return () => {
                listeners.delete(listener);
            };
        },
        clear: () =>
            serialized(async () => {
                await store.removeItem(storeKeyFor(subject));
                await store.removeItem(quarantineKeyFor(subject));
            }),
    };
}

/** One mutator per store and subject, for as long as the store is alive. */
const mutators = new WeakMap<OutboxStore, Map<string, OutboxMutator>>();

/**
 * THE mutator for a user's outbox on a store.
 *
 * ⛔ SHARED, BECAUSE SERIALIZING ONE WRITER PROTECTS NOTHING IF A SECOND WRITER EXISTS. A provider that remounts, or
 * two surfaces that each build one, would otherwise run two queues whose read-modify-writes interleave over one key.
 *
 * @param store - The platform adapter.
 * @param subject - The IdP subject.
 * @returns The same mutator every time for the same pair. @sideEffect Caches it on the store.
 */
export function outboxMutatorFor(store: OutboxStore, subject: string): OutboxMutator {
    const bySubject = mutators.get(store) ?? new Map<string, OutboxMutator>();
    const existing = bySubject.get(subject);

    if (existing !== undefined) {
        return existing;
    }

    const created = createOutboxMutator(store, subject);

    bySubject.set(subject, created);
    mutators.set(store, bySubject);

    return created;
}
