/**
 * @module @kitchensink/sync — the storage port, and the in-memory adapter web uses.
 *
 * ⛔ TWO RULES HERE ARE SECURITY AND DATA-LOSS RULES, not storage details.
 *
 * 1. **Keys are namespaced by user.** A queue keyed by nothing is a cross-account read the first time a
 *    second person signs in on one device. Namespacing makes another user's writes UNREACHABLE rather than
 *    merely cleared — a defence that survives a clear that failed.
 * 2. **The outbox is never silently discarded.** A read cache may be dropped on a version mismatch, because
 *    every entry is re-fetchable. An intent is the cook's unsynced work; deleting it because we shipped a
 *    release is the worst outcome this layer can produce.
 *
 * ⚠️ THE NAMESPACE IS THE IDP SUBJECT, NOT THE APP-USER ULID. The ULID is minted server-side on the first
 * authenticated request, so a client that has never been online does not have one — which is exactly the
 * offline case. The subject travels in the signed token and is available offline.
 *
 * @pattern Port with build-time Adapters — the same shape the shipped `RecentSearchStore` uses (native on
 *     AsyncStorage, web on its own store), so this is the house seam rather than a new idea.
 */
import type { OutboxLog } from './outboxLog.js';
import { LOCAL_SCHEMA_VERSION, type OutboxRecord } from './record.js';

/** The key/value surface both platforms provide. Async because AsyncStorage is. */
export interface OutboxStore {
    getItem: (key: string) => Promise<string | null>;
    setItem: (key: string, value: string) => Promise<void>;
    removeItem: (key: string) => Promise<void>;
}

/** A loaded log, plus how many records could not be read. */
export interface LoadedOutbox extends OutboxLog {
    /** Records present on disk that could not be parsed or are from another schema version. */
    readonly quarantined: number;
}

/**
 * The storage key for one user's outbox.
 *
 * @param subject - The IdP subject from the signed token.
 * @returns The namespaced, versioned key. Pure.
 */
export function storeKeyFor(subject: string): string {
    return `sync.outbox.v${LOCAL_SCHEMA_VERSION}.${subject}`;
}

/** The on-disk envelope. Versioned so a format change is detectable rather than silently misread. */
interface Envelope {
    readonly schemaVersion: number;
    readonly records: readonly OutboxRecord[];
}

/**
 * An in-memory store — the WEB adapter.
 *
 * ⛔ VOLATILE ON PURPOSE (owner ruling): persistence to disk is mobile-only, so no recipe body is left at
 * rest in a browser profile. Web still gets the full optimistic experience and survives a connectivity blip
 * within a session; it does not survive a reload, and the copy says so rather than promising otherwise.
 *
 * @returns A store backed by a Map. @sideEffect Holds state for the session.
 */
export function createMemoryOutboxStore(): OutboxStore {
    const cells = new Map<string, string>();

    return {
        getItem: async (key) => cells.get(key) ?? null,
        setItem: async (key, value) => {
            cells.set(key, value);
        },
        removeItem: async (key) => {
            cells.delete(key);
        },
    };
}

/**
 * Read a user's outbox.
 *
 * ⛔ UNREADABLE DATA IS QUARANTINED, NOT DROPPED AND NOT DRAINED. Dropping discards the cook's work
 * silently; draining sends a payload we could not parse. Quarantining is also what makes per-key write
 * atomicity a non-requirement — a torn write is simply unreadable, and unreadable has a defined answer.
 *
 * @param store - The platform adapter.
 * @param subject - The IdP subject.
 * @returns The log, plus a count of what could not be read. @sideEffect Reads storage.
 */
export async function loadOutbox(store: OutboxStore, subject: string): Promise<LoadedOutbox> {
    const raw = await store.getItem(storeKeyFor(subject));

    if (raw === null) {
        return { records: [], quarantined: 0 };
    }

    let parsed: unknown;

    try {
        parsed = JSON.parse(raw);
    } catch {
        // Unparseable — count it, keep the bytes on disk, and let the surface report an un-syncable item.
        return { records: [], quarantined: 1 };
    }

    const envelope = parsed as Envelope;

    if (envelope.schemaVersion !== LOCAL_SCHEMA_VERSION) {
        return { records: [], quarantined: envelope.records?.length ?? 1 };
    }

    return { records: envelope.records, quarantined: 0 };
}

/**
 * Persist a user's outbox.
 *
 * @param store - The platform adapter.
 * @param subject - The IdP subject.
 * @param log - The log to write.
 * @returns Nothing. @sideEffect Writes storage.
 */
export async function saveOutbox(store: OutboxStore, subject: string, log: OutboxLog): Promise<void> {
    const envelope: Envelope = { schemaVersion: LOCAL_SCHEMA_VERSION, records: log.records };

    await store.setItem(storeKeyFor(subject), JSON.stringify(envelope));
}
