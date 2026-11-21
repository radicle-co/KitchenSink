/**
 * Hydrate and the restore rule: a timer that ended while no tab held it is ended-away, written with the prune in
 * one write. A re-read never settles, so a timer that rang in another tab is left to ring there. Two stores over one
 * port and one lock make the start race of the limit (ADR-0094 section 6).
 */
import { describe, expect, it, vi } from 'vitest';

import { makeFakeLocks, makeFakePort } from '../__fixtures__/fakeKeptPort.js';
import {
    HOUR,
    iso,
    makeDoc,
    makeEnded,
    makePaused,
    makeTimer,
    T0,
    timerId,
    writtenDocument,
} from '../__fixtures__/keptFixtures.js';
import { keptKeyFor, serializeKeptDocument, type KeptDocument } from '../keptRecord.js';
import { createKeptSessionStore, type KeptSnapshot } from '../keptSessionStore.js';
import type { ExclusiveRunner } from '../keptPort.js';

const KEY = keptKeyFor('A');
const NOW = T0 + HOUR;

const docOf = (snapshot: KeptSnapshot): KeptDocument => {
    if (snapshot.status !== 'ready') {
        throw new Error(`expected ready, got ${snapshot.status}`);
    }

    return snapshot.doc;
};

const stored = (doc: KeptDocument): Record<string, string> => ({ [KEY]: serializeKeptDocument(doc) });

function setup(
    initial: Record<string, string>,
    over: {
        readonly heldElsewhere?: (subject: string) => Promise<boolean>;
        readonly locks?: ExclusiveRunner | null;
    } = {},
) {
    const fake = makeFakePort(initial);
    const locks = over.locks === undefined ? makeFakeLocks() : over.locks;
    const store = createKeptSessionStore({
        port: fake.port,
        exclusiveOf: () => locks ?? undefined,
        now: () => iso(NOW),
        report: vi.fn(),
        warn: vi.fn(),
        ...(over.heldElsewhere === undefined ? {} : { heldElsewhere: over.heldElsewhere }),
    });

    return { ...fake, store };
}

const TIMERS = [
    makeTimer({ id: timerId(1), endsAt: iso(NOW - 1000) }),
    makeEnded('ringing', { id: timerId(2), ordinal: 2, endedAt: iso(NOW - 5000) }),
    makeTimer({ id: timerId(3), ordinal: 3, endsAt: iso(NOW + HOUR) }),
    makePaused({ id: timerId(4), ordinal: 4 }),
];

describe('hydrate settles what ended while away', () => {
    it('writes a due running timer and a ringing timer as ended-away at their own ends, in one write', async () => {
        const { store, data, calls } = setup(stored(makeDoc({ timers: TIMERS })));

        await store.scope('A');

        const written = writtenDocument(data.get(KEY));

        expect(written.timers.map((t) => [t.id, t.state])).toEqual([
            [timerId(1), 'endedAway'],
            [timerId(2), 'endedAway'],
            [timerId(3), 'running'],
            [timerId(4), 'paused'],
        ]);
        expect(written.timers[0]).toMatchObject({ endedAt: iso(NOW - 1000) });
        expect(written.timers[1]).toMatchObject({ endedAt: iso(NOW - 5000) });
        expect(calls.write).toBe(1);
        expect(docOf(store.getSnapshot())).toEqual(written);
    });

    it('writes nothing when no timer needs settling', async () => {
        const { store, calls } = setup(stored(makeDoc({ timers: TIMERS.slice(2, 4) })));

        await store.scope('A');

        expect(calls.write).toBe(0);
    });

    it('another tab of this cook alive (the presence lock): due timer left ringing, ringing one stays', async () => {
        const { store, data } = setup(stored(makeDoc({ timers: TIMERS })), {
            heldElsewhere: () => Promise.resolve(true),
        });

        await store.scope('A');

        expect(writtenDocument(data.get(KEY)).timers.map((t) => t.state)).toEqual([
            'ringing',
            'ringing',
            'running',
            'paused',
        ]);
    });

    it('asks whether another tab of this cook is alive for the cook being scoped', async () => {
        const heldElsewhere = vi.fn(() => Promise.resolve(false));
        const { store } = setup(stored(makeDoc({ timers: TIMERS })), { heldElsewhere });

        await store.scope('A');

        expect(heldElsewhere).toHaveBeenCalledWith('A');
    });

    it('with no locks, the view settles in memory and nothing is written', async () => {
        const { store, calls } = setup(stored(makeDoc({ timers: TIMERS })), { locks: null });

        await store.scope('A');

        expect(docOf(store.getSnapshot()).timers.map((t) => t.state)).toEqual([
            'endedAway',
            'endedAway',
            'running',
            'paused',
        ]);
        expect(calls.write).toBe(0);
    });

    it('a re-read never settles: a timer another tab left ringing stays ringing in this one', async () => {
        const { store, data, fire } = setup(stored(makeDoc()));

        await store.scope('A');

        data.set(KEY, serializeKeptDocument(makeDoc({ rev: 5, timers: TIMERS.slice(1, 2) })));
        fire();
        await store.reread();

        expect(docOf(store.getSnapshot()).timers.map((t) => t.state)).toEqual(['ringing']);
    });
});

describe('the start race across two tabs (the limit is read inside the lock)', () => {
    it('two stores on one port and lock start at limit 1 together: one applied, one refused', async () => {
        const fake = makeFakePort({});
        const locks = makeFakeLocks();
        const make = () =>
            createKeptSessionStore({
                port: fake.port,
                exclusiveOf: () => locks,
                now: () => iso(NOW),
                report: vi.fn(),
                warn: vi.fn(),
            });
        const [one, two] = [make(), make()];

        await Promise.all([one.scope('A'), two.scope('A')]);

        const start = (id: string) =>
            ({
                type: 'timer',
                command: {
                    kind: 'start',
                    id,
                    recipeId: 'r1',
                    stepIndex: 3,
                    stepDigest: 's1:0000000d',
                    label: undefined,
                    origin: { kind: 'added' },
                    durationMs: 60_000,
                    limit: 1,
                    nowMs: NOW,
                },
                undo: undefined,
            }) as const;
        const outcomes = await Promise.all([one.dispatch(start(timerId(1))), two.dispatch(start(timerId(2)))]);

        expect(outcomes.map((o) => o.kind).sort((a, b) => a.localeCompare(b))).toEqual(['applied', 'refused']);
        expect(writtenDocument(fake.data.get(KEY)).timers).toHaveLength(1);
    });
});
