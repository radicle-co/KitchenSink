/**
 * @module @kitchensink/sync — setting unreadable bytes aside under a key of their own.
 *
 * A stored format this release cannot read is the cook's data in a shape we do not know. It is neither dropped nor
 * trusted: the raw string is appended to a quarantine key — a JSON list of strings, oldest first — before anything is
 * allowed to overwrite the key it came from. Nothing but a session-end clear removes a quarantine key. The outbox and
 * the editor's draft store each keep one (ADR-0057).
 */
import type { OutboxStore } from './outboxStore.js';

/**
 * Append `raw` to the quarantine list at `key`.
 *
 * @param store - The platform adapter.
 * @param key - The quarantine key.
 * @param raw - The unreadable bytes.
 * @returns Nothing. @sideEffect Reads and writes `key`.
 */
export async function appendToQuarantine(store: OutboxStore, key: string, raw: string): Promise<void> {
    await store.setItem(key, JSON.stringify([...blobsIn(await store.getItem(key)), raw]));
}

/** The blobs a quarantine key already holds. A value that is not this module's list is itself kept as a blob. Pure. */
function blobsIn(existing: string | null): readonly unknown[] {
    if (existing === null) {
        return [];
    }

    try {
        const parsed: unknown = JSON.parse(existing);

        return Array.isArray(parsed) ? parsed : [existing];
    } catch {
        return [existing];
    }
}
