import { describe, expect, it, vi } from 'vitest';

import { makeFakeLocks, makeFakePort } from '../__fixtures__/fakeKeptPort.js';
import { HOUR, iso, makeCooking, makeDoc, makePage, makeTimer, T0, timerId } from '../__fixtures__/keptFixtures.js';
import { isKeptTimersDroppedError } from '../keptErrors.js';
import { keptKeyFor, serializeKeptDocument, type KeptDocument } from '../keptRecord.js';
import { createKeptSessionStore, type KeptSnapshot } from '../keptSessionStore.js';
import type { ExclusiveRunner } from '../keptPort.js';

const KEY_A = keptKeyFor('A');
const NOW = iso(T0 + HOUR);
const tick = { type: 'tickPage', recipeId: 'r1', ingredientId: 'butter', ticked: true } as const;

function setup(initial: Record<string, string> = {}, locks: ExclusiveRunner | null = makeFakeLocks()) {
    const fake = makeFakePort(initial);
    const report = vi.fn();
    const warn = vi.fn();
    const store = createKeptSessionStore({
        port: fake.port,
        exclusiveOf: () => locks ?? undefined,
        now: () => NOW,
        report,
        warn,
    });

    return { ...fake, store, report, warn };
}

const docOf = (snapshot: KeptSnapshot): KeptDocument => {
    if (snapshot.status !== 'ready') {
        throw new Error(`expected ready, got ${snapshot.status}`);
    }

    return snapshot.doc;
};

describe('scope and hydrate', () => {
    it('a document that fails to parse is removed and reads as no record (mutant: kept)', async () => {
        const { store, data } = setup({ [KEY_A]: '{broken' });

        await store.scope('A');

        expect(data.has(KEY_A)).toBe(false);
        expect(docOf(store.getSnapshot()).entries).toEqual({});
    });

    it('undefined removes nothing; null removes all; A then undefined then A keeps A (mutant: removal while loading)', async () => {
        const stored = serializeKeptDocument(makeDoc({ entries: { r1: makeCooking() } }));
        const { store, data } = setup({ [KEY_A]: stored, [keptKeyFor('B')]: stored });

        await store.scope(undefined);
        expect(data.size).toBe(2);
        expect(store.getSnapshot().status).toBe('loading');
        await store.scope('A');
        await store.scope(undefined);
        await store.scope('A');
        expect(data.has(KEY_A)).toBe(true);
        expect(data.has(keptKeyFor('B'))).toBe(false);

        await store.scope(null);
        expect(data.size).toBe(0);
        expect(store.getSnapshot()).toEqual({ status: 'signedOut' });
    });

    it("cook B removes cook A's key", async () => {
        const stored = serializeKeptDocument(makeDoc());
        const { store, data } = setup({ [KEY_A]: stored });

        await store.scope('B');

        expect(data.has(KEY_A)).toBe(false);
    });

    it('RT4: ended session, live session and a stale page entry leave only the live one, in one write', async () => {
        const old = iso(T0 - 25 * HOUR);
        const stored = serializeKeptDocument(
            makeDoc({
                entries: {
                    ended: makeCooking({ lastTouch: old }),
                    live: makeCooking(),
                    page: makePage({ lastTouch: old }),
                },
            }),
        );
        const { store, calls } = setup({ [KEY_A]: stored });

        await store.scope('A');

        expect(Object.keys(docOf(store.getSnapshot()).entries)).toEqual(['live']);
        expect(calls.write).toBe(1);
    });

    it('a hydrate with nothing to prune makes zero writes', async () => {
        const { store, calls } = setup({
            [KEY_A]: serializeKeptDocument(makeDoc({ entries: { live: makeCooking() } })),
        });

        await store.scope('A');

        expect(calls.write).toBe(0);
    });

    it('reports one KeptTimersDroppedError per hydrate with two bad timers', async () => {
        const bad = { ...makeTimer(), label: 'x' };
        const stored = JSON.stringify({ ...makeDoc(), timers: [bad, { ...bad, id: timerId(2) }] });
        const { store, report } = setup({ [KEY_A]: stored });

        await store.scope('A');

        expect(report).toHaveBeenCalledTimes(1);
        expect(isKeptTimersDroppedError(report.mock.calls[0]?.[0])).toBe(true);
    });
});

describe('dispatch', () => {
    it('signed out: a dispatch makes zero writes', async () => {
        const { store, calls } = setup();

        expect(await store.dispatch(tick)).toEqual({ kind: 'unchanged' });
        expect(calls.write).toBe(0);
    });

    it('applies a command, writes it, and notifies', async () => {
        const { store, data } = setup();
        const listener = vi.fn();

        await store.scope('A');
        store.subscribe(listener);
        const outcome = await store.dispatch(tick);

        expect(outcome.kind).toBe('applied');
        expect(listener).toHaveBeenCalledTimes(1);
        expect(JSON.parse(data.get(KEY_A) ?? '{}')).toMatchObject({ rev: 1, entries: { r1: { ticks: ['butter'] } } });
    });

    it('a tick dispatched while loading is applied after the hydrate (mutant: dropped)', async () => {
        const { store, data } = setup({ [KEY_A]: serializeKeptDocument(makeDoc({ rev: 4 })) });
        const scoping = store.scope('A');
        const dispatching = store.dispatch(tick);

        await Promise.all([scoping, dispatching]);

        expect(JSON.parse(data.get(KEY_A) ?? '{}')).toMatchObject({ rev: 5, entries: { r1: { ticks: ['butter'] } } });
    });

    it('write failure: the snapshot keeps the change and one report is made across two failures', async () => {
        const { store, state, report } = setup();

        await store.scope('A');
        state.failWrites = true;
        await store.dispatch(tick);
        await store.dispatch({ ...tick, ingredientId: 'salt' });

        expect(docOf(store.getSnapshot()).entries['r1']).toMatchObject({ ticks: ['butter', 'salt'] });
        expect(report).toHaveBeenCalledTimes(1);
    });

    it('no locks: the snapshot changes, nothing is written, and warn is called once across two dispatches', async () => {
        const { store, calls, warn } = setup({}, null);

        await store.scope('A');
        await store.dispatch(tick);
        await store.dispatch({ ...tick, ingredientId: 'salt' });

        expect(docOf(store.getSnapshot()).entries['r1']).toMatchObject({ ticks: ['butter', 'salt'] });
        expect(calls.write).toBe(0);
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it('joined, refused and unchanged write nothing and leave the snapshot as it is', async () => {
        const stored = serializeKeptDocument(makeDoc({ entries: { r1: makeCooking() } }));
        const { store, calls } = setup({ [KEY_A]: stored });

        await store.scope('A');
        const before = store.getSnapshot();
        const outcome = await store.dispatch({ type: 'startSession', recipeId: 'r1', step: { index: 0, digest: 'd' } });

        expect(outcome.kind).toBe('joined');
        expect(calls.write).toBe(0);
        expect(store.getSnapshot()).toBe(before);
    });
});

describe('reread and snapshot identity', () => {
    it('a re-read with a newer stored rev notifies and makes zero writes (mutant: a re-read that writes)', async () => {
        const { store, data, calls } = setup({ [KEY_A]: serializeKeptDocument(makeDoc({ rev: 1 })) });
        const listener = vi.fn();

        await store.scope('A');
        store.subscribe(listener);
        data.set(KEY_A, serializeKeptDocument(makeDoc({ rev: 7, entries: { r1: makeCooking() } })));
        await store.reread();

        expect(docOf(store.getSnapshot()).rev).toBe(7);
        expect(listener).toHaveBeenCalledTimes(1);
        expect(calls.write).toBe(0);
    });

    it('an external change (storage event) triggers a re-read', async () => {
        const { store, data, fire } = setup({ [KEY_A]: serializeKeptDocument(makeDoc({ rev: 1 })) });

        await store.scope('A');
        data.set(KEY_A, serializeKeptDocument(makeDoc({ rev: 3 })));
        fire();
        await vi.waitFor(() => expect(docOf(store.getSnapshot()).rev).toBe(3));
    });

    it('getSnapshot returns the same object until something changes', async () => {
        const { store } = setup();

        await store.scope('A');

        expect(store.getSnapshot()).toBe(store.getSnapshot());
    });
});
