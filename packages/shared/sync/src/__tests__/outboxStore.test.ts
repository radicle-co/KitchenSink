/**
 * The outbox store — durability, namespacing and what happens to a record we cannot read.
 *
 * ⛔ WRITTEN FROM THE SPECIFICATION, BEFORE THE IMPLEMENTATION EXISTS.
 *
 * ## The two rules that are security and data-loss rules, not storage details
 *
 * 1. **Keys are namespaced by user.** A cache keyed by nothing is a cross-account read the first time a
 *    second person signs in on one device. Namespacing makes another user's queue UNREACHABLE rather than
 *    merely cleared — a defence that survives a clear that failed.
 * 2. **The outbox is never silently discarded.** A read cache may be dropped on a version mismatch, because
 *    every entry is re-fetchable. An INTENT is the cook's unsynced work; dropping it because we shipped a
 *    release is the worst outcome this layer can produce.
 */
import { describe, expect, it } from 'vitest';

import { createMemoryOutboxStore, loadOutbox, saveOutbox, storeKeyFor } from '../outboxStore.js';
import { EMPTY_OUTBOX, appendIntent, type OutboxLog } from '../outboxLog.js';
import { LOCAL_SCHEMA_VERSION, type Intent } from '../record.js';

const EMPTY: OutboxLog = EMPTY_OUTBOX;

function intent(over: Partial<Intent> & Pick<Intent, 'entity' | 'intentKind' | 'localId'>): Intent {
    return { dependsOn: [], payload: {}, ...over } as Intent;
}

describe('storeKeyFor', () => {
    /**
     * ⛔ THE CROSS-ACCOUNT DEFENCE. Two users on one device must not be able to reach each other's queued
     * writes, and the key is what guarantees it structurally.
     */
    it('⛔ namespaces by user, so one device cannot leak a queue between accounts', () => {
        expect(storeKeyFor('user_a')).not.toBe(storeKeyFor('user_b'));
    });

    /**
     * ⚠️ NAMESPACED BY THE IDP SUBJECT, not the app-user ULID. The ULID is minted server-side on the first
     * authenticated request, so a client that has never been online does not have one — which is precisely
     * the offline case this layer exists for. The subject is in the signed token and is available offline.
     */
    it('carries the schema version, so a format change cannot be read as the current one', () => {
        expect(storeKeyFor('user_a')).toContain(String(LOCAL_SCHEMA_VERSION));
    });
});

describe('a round trip', () => {
    /**
     * ⚠️ These compare `.records` rather than the whole result, because a load ALSO reports how many records
     * it could not read. Two assertions in the first draft of this file disagreed about that shape — the
     * count is genuinely needed (an un-syncable item has to reach the cook), so the round trip is the side
     * that yields.
     */
    it('returns what was saved', async () => {
        const store = createMemoryOutboxStore();
        const log = appendIntent(EMPTY, intent({ entity: 'recipe', intentKind: 'update', localId: 'r1' }));

        await saveOutbox(store, 'user_a', log);

        expect((await loadOutbox(store, 'user_a')).records).toStrictEqual(log.records);
    });

    /**
     * ⛔ THE COUNTER AND THE RESOLUTIONS ARE PART OF THE FORMAT. A reloaded counter that restarted at 1 would reuse a
     * sequence number a parked record still holds; reloaded resolutions that came back empty would send a dependent
     * update with its `local:` placeholder in it.
     */
    it('⛔ round-trips the sequence counter, the resolved ids and the pause with the records', async () => {
        const store = createMemoryOutboxStore();
        const log: OutboxLog = {
            ...appendIntent(EMPTY, intent({ entity: 'recipe', intentKind: 'update', localId: 'r1' })),
            resolutions: { 'local:recipe:r0': 'srv-0' },
            pausedUntil: 1_700_000_000_000,
        };

        await saveOutbox(store, 'user_a', log);
        const loaded = await loadOutbox(store, 'user_a');

        expect({
            nextSeq: loaded.nextSeq,
            resolutions: loaded.resolutions,
            pausedUntil: loaded.pausedUntil,
        }).toStrictEqual({
            nextSeq: log.nextSeq,
            resolutions: log.resolutions,
            pausedUntil: log.pausedUntil,
        });
    });

    /** A record that does not have the shape this version writes is unreadable, not half-trusted. */
    it('⛔ quarantines an envelope whose records are not the current shape', async () => {
        const store = createMemoryOutboxStore();
        await store.setItem(
            storeKeyFor('user_a'),
            JSON.stringify({ schemaVersion: LOCAL_SCHEMA_VERSION, nextSeq: 2, resolutions: {}, records: [{}] }),
        );

        const loaded = await loadOutbox(store, 'user_a');

        expect(loaded.records).toStrictEqual([]);
        expect(loaded.quarantined).toBe(1);
    });

    it('reads an empty log for a user who has never queued anything', async () => {
        expect(await loadOutbox(createMemoryOutboxStore(), 'nobody')).toStrictEqual({ ...EMPTY, quarantined: 0 });
    });

    it('⛔ cannot read another user’s queue', async () => {
        const store = createMemoryOutboxStore();
        await saveOutbox(
            store,
            'user_a',
            appendIntent(EMPTY, intent({ entity: 'recipe', intentKind: 'update', localId: 'r1' })),
        );

        expect((await loadOutbox(store, 'user_b')).records).toStrictEqual([]);
    });
});

describe('unreadable data', () => {
    /**
     * ⛔ A CORRUPT RECORD IS QUARANTINED, NOT DROPPED AND NOT DRAINED. Dropping it discards the cook's work
     * silently; draining it sends a payload we could not parse. Quarantine surfaces it as an un-syncable item
     * and is what makes per-key write atomicity a non-requirement — a torn write is simply unreadable, and
     * unreadable is a case with a defined answer.
     */
    it('⛔ quarantines a record it cannot parse rather than dropping it', async () => {
        const store = createMemoryOutboxStore();
        await store.setItem(storeKeyFor('user_a'), '{ this is not json');

        const loaded = await loadOutbox(store, 'user_a');

        expect(loaded.records).toStrictEqual([]);
        expect(loaded.quarantined).toBe(1);
    });

    /**
     * ⛔ A VERSION MISMATCH DOES NOT DISCARD THE OUTBOX. Deleting a cook's unsynced writes because we shipped
     * a release is the worst outcome available here, which is why the read cache and the outbox are governed
     * by different rules.
     */
    it('⛔ keeps an outbox written by an older schema, quarantined rather than deleted', async () => {
        const store = createMemoryOutboxStore();
        const stale = JSON.stringify({ schemaVersion: LOCAL_SCHEMA_VERSION - 1, records: [{ entity: 'recipe' }] });
        await store.setItem(storeKeyFor('user_a'), stale);

        const loaded = await loadOutbox(store, 'user_a');

        expect(loaded.quarantined).toBe(1);
        expect(await store.getItem(storeKeyFor('user_a'))).toBe(stale);
    });
});

describe('clearing', () => {
    /**
     * Sign-out and erasure both clear, but only for the user signing out — another account's queue on the
     * same device is untouched.
     */
    it('⛔ clears only the named user’s queue', async () => {
        const store = createMemoryOutboxStore();
        const log = appendIntent(EMPTY, intent({ entity: 'recipe', intentKind: 'update', localId: 'r1' }));
        await saveOutbox(store, 'user_a', log);
        await saveOutbox(store, 'user_b', log);

        await store.removeItem(storeKeyFor('user_a'));

        expect((await loadOutbox(store, 'user_a')).records).toStrictEqual([]);
        expect((await loadOutbox(store, 'user_b')).records).toStrictEqual(log.records);
    });
});
