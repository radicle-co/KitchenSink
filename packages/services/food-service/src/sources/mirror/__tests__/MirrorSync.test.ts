/**
 * The mirror sync (plan U28, R60, KTD-26): one run keeps one source's mirror current.
 *
 * - One sync runs at a time; a run that cannot take the lock does nothing.
 * - A busy source pauses the run, and it writes nothing (ADR-0053 §4).
 * - An unchanged source version writes nothing, but is still a completed sync: the staleness alarm counts completed
 *   syncs, and a table that changes yearly must not read as stale every day.
 * - Otherwise only changed or reappearing items are written, a vanished item is marked and reported, never deleted,
 *   and the source version is written LAST, so a crash between writes re-diffs on the next run instead of skipping.
 */
import { describe, expect, it } from 'vitest';

import { SourceAccountingError, SourceApiError, SourceBusyError } from '../../foodSource.errors.js';
import { InMemoryMirrorStore } from '../__fixtures__/InMemoryMirrorStore.js';
import type { MirrorDrift } from '../extractDrift.js';
import { mirrorPullOf, type MirrorFeed, type MirrorItem, type MirrorPull } from '../mirrorFeed.js';
import { MirrorSync } from '../MirrorSync.js';

/** A pull of foods, each with a kcal value, by key. */
function pullOf(foods: Record<string, number>): MirrorPull {
    return mirrorPullOf(
        Object.entries(foods).map(([key, kcal]) => ({ externalKey: key, name: `Food ${key}`, payload: { key, kcal } })),
    );
}

/** A feed that answers each pull in turn, or throws. */
function feedOf(...answers: (MirrorPull | Error)[]): MirrorFeed & { pulls: number } {
    const feed = {
        source: 'matvaretabellen' as const,
        pulls: 0,
        async pull(): Promise<MirrorPull> {
            const answer = answers[feed.pulls];

            feed.pulls += 1;

            if (answer === undefined) {
                throw new Error('no more answers');
            }

            if (answer instanceof Error) {
                throw answer;
            }

            return answer;
        },
    };

    return feed;
}

/** A sync over a store and a feed, recording completions and the items drift was computed over. */
function syncOf(feed: MirrorFeed, store: InMemoryMirrorStore, drift: readonly MirrorDrift[] = []) {
    const completed: string[] = [];
    const driftSeen: (readonly MirrorItem[])[] = [];
    const sync = new MirrorSync({
        feed,
        store,
        drift: (items) => {
            driftSeen.push(items);

            return drift;
        },
        metrics: { mirrorSyncCompleted: (source) => completed.push(source) },
    });

    return { sync, completed, driftSeen };
}

describe('MirrorSync', () => {
    it('writes every item, then the source version, on a first sync', async () => {
        const store = new InMemoryMirrorStore();
        const pull = pullOf({ '01.036': 66, '06.178': 310 });
        const { sync, completed } = syncOf(feedOf(pull), store);

        const result = await sync.run();

        expect(result).toEqual({
            outcome: 'synced',
            source: 'matvaretabellen',
            sourceVersion: pull.sourceVersion,
            changed: 2,
            vanished: [],
            drift: [],
        });
        expect(store.writes).toEqual(['upsertChanged:01.036,06.178', 'recordSourceVersion']);
        expect(completed).toEqual(['matvaretabellen']);
    });

    // Rewritten: an unchanged run used to skip the drift check, so drift a changed run reported once (or failed to
    // report) never repeated. It now reports drift on every successful pull, and still writes nothing.
    it('writes nothing when the source version is unchanged, still completes, and reports drift again', async () => {
        const drift: MirrorDrift[] = [{ kind: 'absent', externalKey: '06.178' }];
        const pull = pullOf({ '01.036': 66 });
        const store = new InMemoryMirrorStore(new Map(), pull.sourceVersion);
        const { sync, completed, driftSeen } = syncOf(feedOf(pull), store, drift);

        expect(await sync.run()).toEqual({
            outcome: 'unchanged',
            source: 'matvaretabellen',
            sourceVersion: pull.sourceVersion,
            drift,
        });
        expect(store.writes).toEqual([]);
        expect(driftSeen).toEqual([pull.items]);
        expect(completed).toEqual(['matvaretabellen']);
    });

    it('writes nothing on a second sync of the same content', async () => {
        const store = new InMemoryMirrorStore();
        const { sync } = syncOf(feedOf(pullOf({ '01.036': 66 }), pullOf({ '01.036': 66 })), store);

        await sync.run();
        const writesAfterFirst = [...store.writes];
        await sync.run();

        expect(store.writes).toEqual(writesAfterFirst);
    });

    it('writes only the items whose content changed', async () => {
        const store = new InMemoryMirrorStore();
        const { sync } = syncOf(
            feedOf(pullOf({ '01.036': 66, '06.178': 310 }), pullOf({ '01.036': 67, '06.178': 310 })),
            store,
        );

        await sync.run();
        store.writes.length = 0;
        const result = await sync.run();

        expect(store.writes).toEqual(['upsertChanged:01.036', 'recordSourceVersion']);
        expect(result.outcome === 'synced' && result.changed).toBe(1);
    });

    it('marks and reports an item the source stopped listing, and never deletes it', async () => {
        const store = new InMemoryMirrorStore();
        const { sync } = syncOf(feedOf(pullOf({ '01.036': 66, '06.178': 310 }), pullOf({ '06.178': 310 })), store);

        await sync.run();
        store.writes.length = 0;
        const result = await sync.run();

        expect(result.outcome === 'synced' && result.vanished).toEqual(['01.036']);
        expect(store.writes).toEqual(['markVanished:01.036', 'recordSourceVersion']);
        expect(store.itemFor('01.036')).toMatchObject({ vanished: true });
    });

    it('writes an item again when it reappears, even with its old content', async () => {
        const store = new InMemoryMirrorStore();
        const both = pullOf({ '01.036': 66, '06.178': 310 });
        const { sync } = syncOf(feedOf(both, pullOf({ '06.178': 310 }), both), store);

        await sync.run();
        await sync.run();
        store.writes.length = 0;
        await sync.run();

        expect(store.writes).toEqual(['upsertChanged:01.036', 'recordSourceVersion']);
        expect(store.itemFor('01.036')).toMatchObject({ vanished: false });
    });

    it('returns the drift computed over the pulled items', async () => {
        const drift: MirrorDrift[] = [{ kind: 'absent', externalKey: '01.036' }];
        const pull = pullOf({ '06.178': 310 });
        const { sync, driftSeen } = syncOf(feedOf(pull), new InMemoryMirrorStore(), drift);

        const result = await sync.run();

        expect(result.outcome === 'synced' && result.drift).toEqual(drift);
        expect(driftSeen).toEqual([pull.items]);
    });

    it('pauses and writes nothing when the source is busy', async () => {
        const store = new InMemoryMirrorStore();
        const { sync, completed } = syncOf(
            feedOf(new SourceBusyError('matvaretabellen', 'ceiling', '2026-10-02T00:00:00.000Z')),
            store,
        );

        expect(await sync.run()).toEqual({
            outcome: 'paused',
            source: 'matvaretabellen',
            reason: 'ceiling',
            retryAt: '2026-10-02T00:00:00.000Z',
        });
        expect(store.writes).toEqual([]);
        expect(completed).toEqual([]);
    });

    // Busy pauses, but our own accounting failure fails the run: nothing says when to retry, and the alarm must see it.
    it('fails, and writes nothing, when the transport cannot account for the call', async () => {
        const store = new InMemoryMirrorStore();
        const failure = new SourceAccountingError('matvaretabellen', 'admit', new Error('database unavailable'));
        const { sync, completed } = syncOf(feedOf(failure), store);

        await expect(sync.run()).rejects.toBe(failure);
        expect(store.writes).toEqual([]);
        expect(completed).toEqual([]);
    });

    it('does nothing, not even pull, while another sync holds the lock', async () => {
        const store = new InMemoryMirrorStore();
        const feed = feedOf(pullOf({ '01.036': 66 }));
        const { sync, completed } = syncOf(feed, store);

        store.lockHeld = true;

        expect(await sync.run()).toEqual({ outcome: 'locked', source: 'matvaretabellen' });
        expect(feed.pulls).toBe(0);
        expect(store.writes).toEqual([]);
        expect(completed).toEqual([]);
    });

    it("fails on the source's own error and writes nothing", async () => {
        const store = new InMemoryMirrorStore();
        const failure = new SourceApiError('matvaretabellen', 503, 'Matvaretabellen answered 503');
        const { sync, completed } = syncOf(feedOf(failure), store);

        await expect(sync.run()).rejects.toBe(failure);
        expect(store.writes).toEqual([]);
        expect(completed).toEqual([]);
    });

    it('re-diffs after a crash between writes, because the source version was never recorded', async () => {
        const store = new InMemoryMirrorStore();
        const pull = pullOf({ '01.036': 66 });
        const { sync, completed } = syncOf(feedOf(pull, pull), store);

        store.failNextUpsert = new Error('connection lost');

        await expect(sync.run()).rejects.toThrow('connection lost');
        expect(store.writes).toEqual([]);

        const retried = await sync.run();

        expect(retried.outcome).toBe('synced');
        expect(store.writes).toEqual(['upsertChanged:01.036', 'recordSourceVersion']);
        expect(completed).toEqual(['matvaretabellen']);
    });
});
