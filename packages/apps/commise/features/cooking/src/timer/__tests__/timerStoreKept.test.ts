/**
 * The timer store over the kept record: it writes every change through, rebuilds from the record when no write is
 * in flight, tells `ended` once per (id, run) however the ring is first seen, and stays quiet for what a reload finds.
 * The kept store here is the real one over an in-memory port, so the record's own rules (the limit, the numbers, the
 * restore rule) are the ones under test.
 */
import {
    createKeptSessionStore,
    KEPT_KEY_PREFIX,
    type ExclusiveRunner,
    type KeptPort,
    type KeptSessionStore,
} from '@commise/features-recipes/session';
import { focusManager } from '@tanstack/react-query';
import type { TimerEvent } from '@kitchensink/cooking-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTimerStore, type TimerStore } from '../timerStore.js';

const T0 = Date.parse('2026-11-20T10:00:00.000Z');
const MINUTE = 60_000;
const KEY = `${KEPT_KEY_PREFIX}A`;
const STEP = { recipeId: 'roast', stepIndex: 2, stepDigest: 's1:0000000d', origin: 'added' } as const;

beforeEach(() => {
    vi.useFakeTimers({ now: T0 });
});

afterEach(() => {
    vi.useRealTimers();
});

/** One device: an in-memory port and one lock, shared by every tab built on it. */
function makeDevice(initial: Record<string, string> = {}) {
    const data = new Map(Object.entries(initial));
    const queues = new Map<string, Promise<unknown>>();
    /** While set, a write waits for it: a write in flight that a test can hold open. */
    let gate: Promise<void> | undefined;
    const port: KeptPort = {
        read: (key) => Promise.resolve(data.get(key) ?? null),
        write: async (key, value) => {
            await gate;
            data.set(key, value);

            return { ok: true };
        },
        remove: (key) => {
            data.delete(key);

            return Promise.resolve();
        },
        keys: (prefix) => Promise.resolve([...data.keys()].filter((k) => k.startsWith(prefix))),
    };
    const locks: ExclusiveRunner = (name, work) => {
        const run = (queues.get(name) ?? Promise.resolve()).then(work, work);

        queues.set(
            name,
            run.catch(() => undefined),
        );

        return run;
    };
    const tab = async (
        heldElsewhere?: () => Promise<boolean>,
    ): Promise<{ readonly kept: KeptSessionStore; readonly timers: TimerStore; readonly ended: TimerEvent[] }> => {
        const kept = createKeptSessionStore({
            port,
            exclusiveOf: () => locks,
            now: () => new Date(Date.now()).toISOString(),
            report: vi.fn(),
            warn: vi.fn(),
            ...(heldElsewhere === undefined ? {} : { heldElsewhere }),
        });
        const timers = createTimerStore(undefined, kept);
        const ended: TimerEvent[] = [];

        timers.onEnded((event) => ended.push(event));
        timers.connect();
        await kept.scope('A');
        await settle();

        return { kept, timers, ended };
    };

    /** Holds every write open until the returned function is called. */
    const hold = (): (() => void) => {
        let release = (): void => undefined;

        gate = new Promise<void>((resolve) => {
            release = () => {
                gate = undefined;
                resolve();
            };
        });

        return release;
    };

    return { data, tab, hold };
}

/** Lets every queued promise and the zero-delay timers run. */
const settle = async (): Promise<void> => {
    await vi.advanceTimersByTimeAsync(0);
};

const stored = (device: ReturnType<typeof makeDevice>): { timers: { id: string; state: string; origin: string }[] } =>
    JSON.parse(device.data.get(KEY) ?? '{"timers":[]}');

describe('write-through', () => {
    it('answers a start at once, then holds the timer in the record: running, with its origin and no label', async () => {
        const device = makeDevice();
        const { timers } = await device.tab();

        const id = timers.start({ ...STEP, label: { kind: 'typed', text: 'Secret roast' }, durationMs: 10 * MINUTE });

        expect(timers.getSnapshot().timers[0]).toMatchObject({ id, kind: 'running', label: { text: 'Secret roast' } });

        await settle();

        const record = stored(device);

        expect(record.timers).toHaveLength(1);
        expect(record.timers[0]).toMatchObject({ id, state: 'running', origin: 'added' });
        expect(JSON.stringify(record)).not.toContain('Secret roast');
        expect(timers.getSnapshot().timers[0]?.label?.text).toBe('Secret roast');
    });

    it('writes nothing when a ring finds nothing due, as on every focus', async () => {
        const device = makeDevice();
        const { kept, timers } = await device.tab();

        timers.start({ ...STEP, label: undefined, durationMs: 10 * MINUTE });
        await settle();

        const dispatch = vi.spyOn(kept, 'dispatch');

        focusManager.setFocused(false);
        vi.setSystemTime(Date.now() + MINUTE);
        focusManager.setFocused(true);
        await settle();

        expect(dispatch).not.toHaveBeenCalled();
        focusManager.setFocused();
    });

    it('writes a pause, a +time and a cancel through', async () => {
        const device = makeDevice();
        const { timers } = await device.tab();
        const id = timers.start({ ...STEP, label: undefined, durationMs: 10 * MINUTE });

        timers.command({ kind: 'pause', id: id ?? '', run: 1 });
        await settle();
        expect(stored(device).timers[0]).toMatchObject({ state: 'paused' });

        timers.command({ kind: 'resume', id: id ?? '', run: 1 });
        timers.command({ kind: 'cancel', id: id ?? '', run: 1 });
        await settle();
        expect(stored(device).timers).toEqual([]);
    });
});

describe('hydration, and a reload (no sound for what ended while away)', () => {
    it('a reload past the end shows an ended-away timer and raises no ended event', async () => {
        const device = makeDevice();
        const first = await device.tab();

        first.timers.start({ ...STEP, label: undefined, durationMs: 5 * MINUTE });
        await settle();
        vi.setSystemTime(T0 + 10 * MINUTE);

        const reloaded = await device.tab();

        expect(reloaded.timers.getSnapshot().timers[0]).toMatchObject({ kind: 'endedAway', endedAt: T0 + 5 * MINUTE });
        expect(reloaded.ended).toEqual([]);
    });

    it('a reload before the end keeps the timer running with the time left, and the origin survives', async () => {
        const device = makeDevice();
        const first = await device.tab();

        first.timers.start({ ...STEP, origin: 'offer', label: undefined, durationMs: 90 * MINUTE });
        await settle();
        vi.setSystemTime(T0 + 20 * MINUTE);

        const reloaded = await device.tab();
        const timer = reloaded.timers.getSnapshot().timers[0];

        expect(timer).toMatchObject({ kind: 'running', endsAt: T0 + 90 * MINUTE, origin: 'offer', label: undefined });
    });
});

describe('a reload beside a tab of this cook that is alive', () => {
    it('shows the ringing timer and tells nothing: a tab that loads must not sound a ring it did not hear', async () => {
        const device = makeDevice();
        const first = await device.tab();

        first.timers.start({ ...STEP, label: undefined, durationMs: 5 * MINUTE });
        await settle();
        await vi.advanceTimersByTimeAsync(5 * MINUTE);
        await settle();

        const reloaded = await device.tab(() => Promise.resolve(true));

        expect(reloaded.timers.getSnapshot().timers[0]?.kind).toBe('ringing');
        expect(reloaded.ended).toEqual([]);
    });
});

describe('ended is told once per (id, run)', () => {
    it('a timer that rings here is told once, though the record then shows it ringing too', async () => {
        const device = makeDevice();
        const { timers, ended } = await device.tab();

        timers.start({ ...STEP, label: undefined, durationMs: 5 * MINUTE });
        await settle();
        await vi.advanceTimersByTimeAsync(5 * MINUTE);
        await settle();

        expect(timers.getSnapshot().timers[0]?.kind).toBe('ringing');
        expect(ended).toHaveLength(1);
    });

    it('a timer another tab rang is told once here, when its record change arrives', async () => {
        const device = makeDevice();
        const one = await device.tab();
        const two = await device.tab();

        const id = one.timers.start({ ...STEP, label: undefined, durationMs: 5 * MINUTE });

        await settle();
        // Tab two never holds the running timer, so its own timeout cannot ring it: only the record can.
        await vi.advanceTimersByTimeAsync(5 * MINUTE);
        await settle();
        await two.kept.reread();
        await settle();

        expect(two.ended).toEqual([{ kind: 'ended', id, run: 1 }]);

        await two.kept.reread();
        await settle();

        expect(two.ended).toHaveLength(1);
    });

    it('a timer that rings a second run in another tab is told again here, once per run', async () => {
        const device = makeDevice();
        const one = await device.tab();
        const two = await device.tab();

        const id = one.timers.start({ ...STEP, label: undefined, durationMs: MINUTE });

        await settle();
        await vi.advanceTimersByTimeAsync(MINUTE);
        await settle();
        await two.kept.reread();
        await settle();
        one.timers.command({ kind: 'addTime', id: id ?? '', run: 1, addMs: MINUTE });
        await settle();
        await vi.advanceTimersByTimeAsync(MINUTE);
        await settle();

        expect(one.timers.getSnapshot().timers[0]).toMatchObject({ kind: 'ringing', run: 2 });

        await two.kept.reread();
        await settle();

        expect(two.ended.map((event) => event.run)).toEqual([1, 2]);

        await two.kept.reread();
        await settle();

        expect(two.ended).toHaveLength(2);
    });
});

describe('the record is the truth across tabs', () => {
    it("a start the record refuses at the limit shows the record's timer after one round trip, with no copy", async () => {
        const device = makeDevice();
        const one = await device.tab();
        const two = await device.tab();

        one.timers.start({ ...STEP, label: undefined, durationMs: 10 * MINUTE });
        await settle();

        // `two` has not re-read yet: its memory is empty, so it takes the start, and the record refuses it.
        two.timers.start({ ...STEP, stepIndex: 5, label: undefined, durationMs: 10 * MINUTE });
        await settle();

        expect(stored(device).timers).toHaveLength(1);
        expect(two.timers.getSnapshot().timers.map((t) => t.id)).toEqual(stored(device).timers.map((t) => t.id));
    });

    it('an Undo the record refuses is put back, so the cook can free a slot and try again', async () => {
        const device = makeDevice();
        const one = await device.tab();
        const two = await device.tab();
        const id = one.timers.start({ ...STEP, label: undefined, durationMs: 10 * MINUTE });

        await settle();
        one.timers.command({ kind: 'cancel', id: id ?? '', run: 1 });
        await settle();
        expect(one.timers.getSnapshot().undo?.id).toBe(id);

        two.timers.start({ ...STEP, stepIndex: 5, label: undefined, durationMs: 10 * MINUTE });
        await settle();
        one.timers.command({ kind: 'restore' });
        await settle();

        expect(one.timers.getSnapshot().undo?.id).toBe(id);
        expect(stored(device).timers).toHaveLength(1);
        expect(one.timers.getSnapshot().timers.map((t) => t.id)).toEqual(stored(device).timers.map((t) => t.id));
    });
});

describe('a write in flight', () => {
    it('does not flicker back: a pause made while the start is still being written never shows running again', async () => {
        const device = makeDevice();
        const { timers } = await device.tab();
        const seen: string[] = [];
        const id = timers.start({ ...STEP, label: undefined, durationMs: 10 * MINUTE });

        timers.subscribe(() => seen.push(timers.getSnapshot().timers[0]?.kind ?? 'none'));
        timers.command({ kind: 'pause', id: id ?? '', run: 1 });
        await settle();

        expect(seen).not.toContain('running');
        expect(timers.getSnapshot().timers[0]?.kind).toBe('paused');
    });

    it('is not undone by a record change that arrives meanwhile', async () => {
        const device = makeDevice();
        const one = await device.tab();
        const two = await device.tab();
        const release = device.hold();

        one.timers.start({ ...STEP, label: undefined, durationMs: 10 * MINUTE });
        two.timers.start({ ...STEP, recipeId: 'other', label: undefined, durationMs: 10 * MINUTE });
        await settle();
        release();
        await settle();
        await one.kept.reread();
        await settle();

        // Whatever the record settled on, memory never lost the cook's own timer to a read taken mid-write.
        expect(one.timers.getSnapshot().timers.map((t) => t.id)).toEqual(stored(device).timers.map((t) => t.id));
    });
});

describe('clear', () => {
    it('empties the memory, forgets what it told, and dispatches nothing (the record ends through the kept store)', async () => {
        const device = makeDevice();
        const { timers } = await device.tab();

        timers.start({ ...STEP, label: undefined, durationMs: 10 * MINUTE });
        await settle();
        timers.observeCook('A');
        timers.observeCook('B');

        expect(timers.getSnapshot().timers).toEqual([]);
        expect(stored(device).timers).toHaveLength(1);
    });
});
