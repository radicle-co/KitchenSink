/**
 * The timer store over the real reducer, the real clock under fake timers and TanStack's real `focusManager`
 * (S3a.U3 C3; blueprint cases 1 to 7). Only time is stood in for: `vi.useFakeTimers` drives `Date.now` and
 * `setTimeout`, so a case can move the clock without firing a timeout, as a phone does when it sleeps.
 */
import { focusManager } from '@tanstack/react-query';
import { NO_TIMER, reduceTimer, type TimerCommand, type TimerEvent, type TimerState } from '@kitchensink/cooking-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTimerStore } from '../../src/timer/timerStore.js';

const T0 = Date.parse('2026-11-20T10:00:00.000Z');
const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const STEP = {
    recipeId: 'roast',
    stepIndex: 2,
    stepDigest: 's1:0000000d',
    label: undefined,
    origin: { kind: 'added' },
} as const;

/** Each connection a case made, so none outlives it. */
const connections: (() => void)[] = [];

const storeOf = (initial?: TimerState) => {
    const store = createTimerStore(initial);

    connections.push(store.connect());

    return store;
};

/** Ring events a store told, in order. */
function listen(store: ReturnType<typeof createTimerStore>): TimerEvent[] {
    const told: TimerEvent[] = [];

    store.onEnded((event) => told.push(event));

    return told;
}

/** A state built by the real reducer with room for several timers, as S6 will hold. */
function stateOf(...commands: readonly TimerCommand[]): TimerState {
    return commands.reduce<TimerState>((state, command) => reduceTimer(state, command).state, NO_TIMER);
}

const startAt = (id: string, durationMs: number, nowMs = T0): TimerCommand => ({
    kind: 'start',
    id,
    ...STEP,
    origin: { kind: 'added' },
    durationMs,
    limit: 10,
    nowMs,
});

/** A spy on `setTimeout` that calls through to the fake timer and records every call. */
const watchArms = () => vi.spyOn(globalThis, 'setTimeout');

/** The delays the store gave `setTimeout`, in order. */
const delaysOf = (arms: ReturnType<typeof watchArms>): number[] => arms.mock.calls.flatMap(([, delay]) => delay ?? []);

beforeEach(() => {
    vi.useFakeTimers({ now: T0 });
    focusManager.setFocused(false);
});

afterEach(() => {
    for (const disconnect of connections.splice(0)) {
        disconnect();
    }

    vi.useRealTimers();
    vi.restoreAllMocks();
    focusManager.setFocused();
});

describe('the app comes to the front', () => {
    it('rings a timer that ended while the app slept, at its own end, with one ended', () => {
        const store = storeOf();
        const told = listen(store);

        store.start({ ...STEP, durationMs: 5 * SECOND });
        // The phone slept: the clock moved on and no timeout ran.
        vi.setSystemTime(T0 + 70 * SECOND);
        focusManager.setFocused(true);

        expect(store.getSnapshot().timers).toMatchObject([{ kind: 'ringing', endedAt: T0 + 5 * SECOND }]);
        expect(told).toHaveLength(1);

        focusManager.setFocused(false);
        expect(told).toHaveLength(1);
    });

    it('sends nothing when the app goes to the back', () => {
        const store = storeOf();
        const told = listen(store);

        store.start({ ...STEP, durationMs: 5 * SECOND });
        focusManager.setFocused(true);
        vi.setSystemTime(T0 + 70 * SECOND);
        focusManager.setFocused(false);

        expect(store.getSnapshot().timers).toMatchObject([{ kind: 'running' }]);
        expect(told).toEqual([]);
    });
});

describe('the one timeout', () => {
    it('that fires 1 ms early rings nothing, re-arms, and rings at the end', () => {
        const store = storeOf();
        const told = listen(store);

        store.start({ ...STEP, durationMs: 5 * SECOND });
        // The timeout waits 5 s of fake time, and the clock reads 1 ms short of the end when it fires.
        vi.setSystemTime(T0 - 1);
        vi.advanceTimersByTime(5 * SECOND);

        expect(told).toEqual([]);
        expect(store.getSnapshot().timers).toMatchObject([{ kind: 'running' }]);

        vi.advanceTimersByTime(1);

        expect(told).toHaveLength(1);
        expect(store.getSnapshot().timers).toMatchObject([{ kind: 'ringing', endedAt: T0 + 5 * SECOND }]);
    });

    it('is never longer than 60 s, and a 1 h 30 timer rings once', () => {
        const arms = watchArms();
        const store = storeOf();
        const told = listen(store);

        store.start({ ...STEP, durationMs: 90 * MINUTE });
        vi.advanceTimersByTime(90 * MINUTE);

        expect(Math.max(...delaysOf(arms))).toBeLessThanOrEqual(MINUTE);
        expect(told).toHaveLength(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('waits for the earliest running timer, not the first in the list', () => {
        // The later one was started first, so it is first in the list.
        const arms = watchArms();
        const store = storeOf(stateOf(startAt('t1', 90 * SECOND), startAt('t2', 30 * SECOND)));
        const told = listen(store);

        expect(delaysOf(arms)).toEqual([30 * SECOND]);

        vi.advanceTimersByTime(30 * SECOND);

        expect(delaysOf(arms)).toEqual([30 * SECOND, MINUTE]);
        expect(told.map((e) => e.id)).toEqual(['t2']);

        vi.advanceTimersByTime(MINUTE);

        expect(told.map((e) => e.id)).toEqual(['t2', 't1']);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('arms nothing with no running timer', () => {
        const store = storeOf();

        expect(vi.getTimerCount()).toBe(0);

        store.start({ ...STEP, durationMs: 5 * SECOND });
        store.command({ kind: 'pause', id: store.getSnapshot().timers[0]?.id ?? '', run: 1 });

        expect(vi.getTimerCount()).toBe(0);
    });
});

describe('the timeout and the foreground in the same millisecond', () => {
    it('give one ended', () => {
        const store = storeOf();
        const told = listen(store);

        store.start({ ...STEP, durationMs: 5 * SECOND });
        vi.advanceTimersByTime(5 * SECOND);
        focusManager.setFocused(true);

        expect(told).toHaveLength(1);
    });
});

describe('Undo at limit 1', () => {
    it('is not held once a new timer starts', () => {
        const store = storeOf();

        store.start({ ...STEP, durationMs: 5 * MINUTE });
        store.command({ kind: 'cancel', id: store.getSnapshot().timers[0]?.id ?? '', run: 1 });

        expect(store.getSnapshot().undo).toBeDefined();

        store.start({ ...STEP, durationMs: 5 * MINUTE });

        expect(store.getSnapshot().undo).toBeUndefined();
        expect(store.getSnapshot().timers).toHaveLength(1);
    });

    it('is refused a restore beside a running timer, changing nothing and throwing nothing', () => {
        // Another tab cancelled t1 and started t2 under a larger limit: this store holds both a timer and an Undo.
        const store = storeOf(
            stateOf(startAt('t1', 5 * MINUTE), { kind: 'cancel', id: 't1', run: 1, nowMs: T0 }, startAt('t2', MINUTE)),
        );
        const before = store.getSnapshot();

        expect(before.undo?.id).toBe('t1');
        expect(() => {
            store.command({ kind: 'restore' });
        }).not.toThrow();
        expect(store.getSnapshot()).toBe(before);
    });

    it('refuses a second start at the limit, shows nothing and keeps the state', () => {
        const store = storeOf();

        store.start({ ...STEP, durationMs: 5 * MINUTE });
        const before = store.getSnapshot();

        expect(store.start({ ...STEP, durationMs: MINUTE })).toBeUndefined();
        expect(store.getSnapshot()).toBe(before);
    });
});

describe('a change of cook', () => {
    /** Running t1, ringing t2 and a held Undo t3. */
    const crowded = () =>
        stateOf(
            startAt('t1', 90 * MINUTE),
            startAt('t2', 5 * SECOND),
            { kind: 'ring', nowMs: T0 + 10 * SECOND },
            startAt('t3', 30 * MINUTE, T0 + 10 * SECOND),
            { kind: 'cancel', id: 't3', run: 1, nowMs: T0 + 11 * SECOND },
        );

    it.each([
        ['another cook', 'B'],
        ['nobody', null],
    ])('to %s clears every timer and the Undo, with no ended', (_name, next) => {
        const store = storeOf(crowded());
        const told = listen(store);

        expect(store.getSnapshot().timers).toHaveLength(2);
        expect(store.getSnapshot().undo?.id).toBe('t3');

        store.observeCook('A');
        store.observeCook(next);

        expect(store.getSnapshot()).toEqual(NO_TIMER);
        expect(told).toEqual([]);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('clears a timer that was already due, as stopped, with no ended', () => {
        const store = storeOf(stateOf(startAt('t1', 5 * SECOND)));
        const told = listen(store);

        store.observeCook('A');
        vi.setSystemTime(T0 + MINUTE);
        store.observeCook('B');

        expect(store.getSnapshot()).toEqual(NO_TIMER);
        expect(told).toEqual([]);
    });

    it('drops a held Undo with no timer beside it, so a restore after the change does nothing', () => {
        const store = storeOf(stateOf(startAt('t1', 5 * MINUTE), { kind: 'cancel', id: 't1', run: 1, nowMs: T0 }));

        expect(store.getSnapshot().undo?.id).toBe('t1');

        store.observeCook('A');
        store.observeCook('B');
        store.command({ kind: 'restore' });

        expect(store.getSnapshot()).toEqual(NO_TIMER);
    });

    it('keeps everything while Clerk is loading (undefined)', () => {
        const store = storeOf(crowded());

        store.observeCook('A');
        const before = store.getSnapshot();

        store.observeCook(undefined);

        expect(store.getSnapshot()).toBe(before);
    });

    it('keeps everything for the same cook, and for a first value of nobody', () => {
        const store = storeOf(crowded());

        store.observeCook(null);
        store.observeCook('A');
        store.observeCook('A');

        expect(store.getSnapshot().timers).toHaveLength(2);
        expect(store.getSnapshot().undo?.id).toBe('t3');
    });
});

describe('the store ends with its disconnect', () => {
    it('clears its timeout and stops hearing the foreground', () => {
        const store = createTimerStore();
        const told = listen(store);
        const disconnect = store.connect();

        store.start({ ...STEP, durationMs: 5 * SECOND });
        disconnect();

        expect(vi.getTimerCount()).toBe(0);

        vi.setSystemTime(T0 + MINUTE);
        focusManager.setFocused(true);

        expect(told).toEqual([]);
    });

    it('works after a disconnect and a connect again (StrictMode runs an effect, its cleanup, and the effect)', () => {
        const store = createTimerStore();
        const told = listen(store);

        store.connect()();
        connections.push(store.connect());
        store.start({ ...STEP, durationMs: 5 * SECOND });
        vi.setSystemTime(T0 + MINUTE);
        focusManager.setFocused(true);

        expect(told).toHaveLength(1);
        expect(vi.getTimerCount()).toBe(0);
    });
});
