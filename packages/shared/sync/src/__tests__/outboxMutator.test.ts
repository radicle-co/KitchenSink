/**
 * The outbox mutator — the ONE writer of a user's outbox.
 *
 * ⛔ WRITTEN BEFORE THE IMPLEMENTATION, from the defect `syncProvider.tsx` recorded as owed before the first `submit`
 * call site: the drain wrote back the snapshot it LOADED, so a record a concurrent `submit` appended was clobbered in
 * storage while the UI still counted it. The cure has three parts and each is asserted here:
 *
 * 1. every change is a function of the log as it is NOW, read from the store, applied one at a time;
 * 2. the store is the only authority — no change is applied to a copy that could be stale;
 * 3. a failed write rejects that change only, and the next change still runs.
 */
import { describe, expect, it, vi } from 'vitest';

import { createOutboxMutator, outboxMutatorFor } from '../outboxMutator.js';
import { EMPTY_OUTBOX, appendIntent, markSending, settle } from '../outboxLog.js';
import { createMemoryOutboxStore, loadOutbox, quarantineKeyFor, saveOutbox, storeKeyFor } from '../outboxStore.js';
import type { Intent } from '../record.js';

function intent(over: Partial<Intent> & Pick<Intent, 'entity' | 'intentKind' | 'localId'>): Intent {
    return { dependsOn: [], payload: {}, ...over } as Intent;
}

const update = (localId: string, payload: unknown = {}): Intent =>
    intent({ entity: 'recipe', intentKind: 'update', localId, payload });

describe('createOutboxMutator — one writer', () => {
    /**
     * ⛔ THE CLOBBER. The drain reads a snapshot, sends, and reports back; a `submit` lands in between. Both changes
     * must survive, which only holds when each is applied to the log as stored at the moment it runs.
     */
    it('⛔ keeps a record appended while a drain was sending', async () => {
        const store = createMemoryOutboxStore();
        const mutator = createOutboxMutator(store, 'user_a');

        await mutator.mutate((log) => appendIntent(log, update('r1')));
        const snapshot = await mutator.read();
        await mutator.mutate((log) => markSending(log, 1));

        // The cook edits a second recipe while r1 is on the wire.
        await mutator.mutate((log) => appendIntent(log, update('r2')));
        await mutator.mutate((log) =>
            settle(log, { seq: snapshot.records[0]?.seq ?? 0, outcome: 'synced', serverId: 's' }),
        );

        expect((await loadOutbox(store, 'user_a')).records.map((record) => record.localId)).toStrictEqual(['r2']);
    });

    it('⛔ applies changes one at a time, in the order they were asked for, losing none', async () => {
        const store = createMemoryOutboxStore();
        const mutator = createOutboxMutator(store, 'user_a');

        await Promise.all(['a', 'b', 'c', 'd'].map((id) => mutator.mutate((log) => appendIntent(log, update(id)))));

        expect((await mutator.read()).records.map((record) => [record.localId, record.seq])).toStrictEqual([
            ['a', 1],
            ['b', 2],
            ['c', 3],
            ['d', 4],
        ]);
    });

    it('applies each change to what the store holds now, not to a copy it read earlier', async () => {
        const store = createMemoryOutboxStore();
        const mutator = createOutboxMutator(store, 'user_a');
        await mutator.read();

        // Another writer of the same key — the stand-in for "storage changed under us".
        await saveOutbox(store, 'user_a', appendIntent(EMPTY_OUTBOX, update('elsewhere')));
        await mutator.mutate((log) => appendIntent(log, update('here')));

        expect((await mutator.read()).records.map((record) => record.localId)).toStrictEqual(['elsewhere', 'here']);
    });

    it('rejects a change whose write fails, keeps the stored log, and still runs the next change', async () => {
        const store = createMemoryOutboxStore();
        const mutator = createOutboxMutator(store, 'user_a');
        await mutator.mutate((log) => appendIntent(log, update('kept')));
        const setItem = vi.spyOn(store, 'setItem').mockRejectedValueOnce(new Error('disk full'));

        await expect(mutator.mutate((log) => appendIntent(log, update('lost')))).rejects.toThrow('disk full');
        await mutator.mutate((log) => appendIntent(log, update('next')));

        expect(setItem).toHaveBeenCalledTimes(2);
        expect((await mutator.read()).records.map((record) => record.localId)).toStrictEqual(['kept', 'next']);
    });

    it('tells subscribers the log after every change, and stops when they unsubscribe', async () => {
        const mutator = createOutboxMutator(createMemoryOutboxStore(), 'user_a');
        const seen: number[] = [];
        const unsubscribe = mutator.subscribe((log) => seen.push(log.records.length));

        await mutator.mutate((log) => appendIntent(log, update('a')));
        unsubscribe();
        await mutator.mutate((log) => appendIntent(log, update('b')));

        expect(seen).toStrictEqual([1]);
    });
});

describe('createOutboxMutator — the first read', () => {
    /**
     * ⛔ QUARANTINED BYTES ARE MOVED ASIDE BEFORE ANYTHING WRITES. The outbox key is overwritten by the next change,
     * so bytes left there "quarantined" were destroyed by the first `submit` after a release that could not read
     * them. They go to their own key, which nothing but a clear removes.
     */
    it('⛔ moves unreadable bytes to the quarantine key before the first write replaces them', async () => {
        const store = createMemoryOutboxStore();
        await store.setItem(storeKeyFor('user_a'), '{ not json');
        const mutator = createOutboxMutator(store, 'user_a');

        await mutator.mutate((log) => appendIntent(log, update('r1')));

        expect(JSON.parse((await store.getItem(quarantineKeyFor('user_a'))) ?? '[]')).toStrictEqual(['{ not json']);
        expect((await mutator.read()).records.map((record) => record.localId)).toStrictEqual(['r1']);
    });

    it('keeps every quarantined blob, rather than the latest overwriting the earlier', async () => {
        const store = createMemoryOutboxStore();
        await store.setItem(quarantineKeyFor('user_a'), JSON.stringify(['older']));
        await store.setItem(storeKeyFor('user_a'), 'newer');

        await createOutboxMutator(store, 'user_a').read();

        expect(JSON.parse((await store.getItem(quarantineKeyFor('user_a'))) ?? '[]')).toStrictEqual(['older', 'newer']);
    });

    /** ⛔ A RECORD LEFT `sending` BY A DEAD PROCESS IS PARKED, ONCE, ON THE FIRST READ — never re-sent blind. */
    it('⛔ parks a record a previous process left mid-send', async () => {
        const store = createMemoryOutboxStore();
        await saveOutbox(store, 'user_a', markSending(appendIntent(EMPTY_OUTBOX, update('r1')), 1));

        const log = await createOutboxMutator(store, 'user_a').read();

        expect(log.records.map((record) => [record.state, record.lastStatus])).toStrictEqual([['parked', undefined]]);
        expect((await loadOutbox(store, 'user_a')).records[0]?.state).toBe('parked');
    });

    it('does not park a record its OWN drain marked sending', async () => {
        const mutator = createOutboxMutator(createMemoryOutboxStore(), 'user_a');
        await mutator.mutate((log) => appendIntent(log, update('r1')));
        await mutator.mutate((log) => markSending(log, 1));

        expect((await mutator.read()).records[0]?.state).toBe('sending');
    });
});

/**
 * ⛔ ONE WRITER PER OUTBOX, NOT ONE PER CALLER. Serializing inside one mutator protects nothing if a remounted provider
 * builds a second mutator over the same key: two queues would interleave their read-modify-writes again.
 */
describe('outboxMutatorFor', () => {
    it('⛔ returns the same mutator for the same store and subject, and a different one otherwise', () => {
        const store = createMemoryOutboxStore();

        expect(outboxMutatorFor(store, 'user_a')).toBe(outboxMutatorFor(store, 'user_a'));
        expect(outboxMutatorFor(store, 'user_a')).not.toBe(outboxMutatorFor(store, 'user_b'));
        expect(outboxMutatorFor(store, 'user_a')).not.toBe(outboxMutatorFor(createMemoryOutboxStore(), 'user_a'));
    });
});
