/**
 * @module @kitchensink/sync — the unreadable-work ledger: how many times this session set a cook's unreadable bytes
 * aside, so the UI can tell them once (`docs/design/uiOverhaul/specSharedSystem.md` §17).
 *
 * ⛔ A COUNT OF THIS SESSION'S EVENTS, NEVER A READING OF THE QUARANTINE KEY. The key lives until sign-out (on mobile
 * across launches), so a notice derived from "the key exists" would come back on every start. The ledger is in memory,
 * one per store OBJECT and cook (the same sharing rule as `outboxMutatorFor`), so a new load starts at zero whatever
 * the store holds, and `appendToQuarantine` — the one place bytes are set aside, for the outbox and the editor's draft
 * alike — is the one place that counts.
 *
 * ⛔ IT LIVES HERE BECAUSE `@commise/query` CANNOT IMPORT `features-recipes`: both stores report into this leaf package,
 * and the provider reads from it, so the fact flows through `@kitchensink/sync` and never sideways.
 *
 * @pattern Observer over a small in-memory fact — a counter with subscribers, shared per store and cook.
 */
import { createFanout, type FaultSink } from './fanout.js';
import type { OutboxStore } from './outboxStore.js';

/** A cook's count of set-aside events on one store. */
export interface UnreadableLedger {
    /** How many times unreadable bytes were set aside since this ledger was made or last reset. */
    readonly count: () => number;
    /** Count one set-aside and tell every subscriber the new count. */
    readonly record: () => void;
    /** Back to zero (the session-end clear), telling subscribers only if the count changed. */
    readonly reset: () => void;
    /**
     * Hear the count after each change. Returns the unsubscribe. A listener that throws is isolated from the others and
     * from the quarantine write that is reporting; `onFault` receives what it threw.
     */
    readonly subscribe: (listener: (count: number) => void, onFault?: FaultSink) => () => void;
}

/** Make a ledger. Pure construction; the returned functions mutate its own count and listeners. */
function createUnreadableLedger(): UnreadableLedger {
    const fanout = createFanout<number>();
    let count = 0;

    return {
        count: () => count,
        record: () => {
            count += 1;
            fanout.publish(count);
        },
        reset: () => {
            if (count === 0) {
                return;
            }

            count = 0;
            fanout.publish(count);
        },
        subscribe: fanout.subscribe,
    };
}

const ledgers = new WeakMap<OutboxStore, Map<string, UnreadableLedger>>();

/**
 * THE ledger for a cook on a store.
 *
 * @param store - The platform adapter.
 * @param subject - The IdP subject.
 * @returns The same ledger every time for the same pair. @sideEffect Caches it on the store.
 */
export function unreadableLedgerFor(store: OutboxStore, subject: string): UnreadableLedger {
    const bySubject = ledgers.get(store) ?? new Map<string, UnreadableLedger>();
    const existing = bySubject.get(subject);

    if (existing !== undefined) {
        return existing;
    }

    const created = createUnreadableLedger();

    bySubject.set(subject, created);
    ledgers.set(store, bySubject);

    return created;
}
