/**
 * The timer reducer, one command at a time. The whole model is a pure function of (state, command with its clock), so
 * every case names its instants and nothing waits. The table of states and edges is the plan's own: running, paused,
 * ringing, and a held snapshot for Undo.
 */
import { describe, expect, it } from 'vitest';

import { isInvalidTimerDurationError, isTimerAlreadyActiveError } from '../errors.js';
import {
    MAX_TIMER_MS,
    MIN_TIMER_MS,
    NO_TIMER,
    reduceTimer,
    timeLeftMs,
    type TimerCommand,
    type TimerEvent,
    type TimerState,
} from '../timer.js';

const SECOND = 1_000;
const MINUTE = 60 * SECOND;

const START = {
    kind: 'start',
    id: 't1',
    recipeId: 'roast',
    stepIndex: 3,
    name: 'Roast',
    durationMs: 90 * MINUTE,
} as const;

/** Apply commands in order, collecting every event. */
function run(commands: readonly TimerCommand[], from: TimerState = NO_TIMER) {
    let state = from;
    const events: TimerEvent[] = [];

    for (const command of commands) {
        const result = reduceTimer(state, command);
        state = result.state;
        events.push(...result.events);
    }

    return { state, events };
}

const started = (nowMs = 0) => run([{ ...START, nowMs }]).state;

describe('start', () => {
    it('runs from the instant it was started, with a stable id and run 1', () => {
        const state = started(1_000);

        expect(state.timer).toEqual({
            kind: 'running',
            id: 't1',
            run: 1,
            recipeId: 'roast',
            stepIndex: 3,
            name: 'Roast',
            durationMs: 90 * MINUTE,
            endsAt: 1_000 + 90 * MINUTE,
        });
        expect(state.undo).toBeUndefined();
    });

    it.each([
        ['4 s', MIN_TIMER_MS - SECOND, false],
        ['5 s', MIN_TIMER_MS, true],
        ['24 h', MAX_TIMER_MS, true],
        ['24 h and 1 s', MAX_TIMER_MS + SECOND, false],
    ])('%s: accepted is %s', (_label, durationMs, accepted) => {
        const attempt = () => reduceTimer(NO_TIMER, { ...START, durationMs, nowMs: 0 });

        if (accepted) {
            expect(attempt().state.timer?.kind).toBe('running');
        } else {
            expect(attempt).toThrow(expect.toSatisfy(isInvalidTimerDurationError));
        }
    });

    it.each([Number.NaN, Number.POSITIVE_INFINITY, 5_000.5])('refuses a duration of %s', (durationMs) => {
        expect(() => reduceTimer(NO_TIMER, { ...START, durationMs, nowMs: 0 })).toThrow(
            expect.toSatisfy(isInvalidTimerDurationError),
        );
    });

    it.each(['running', 'paused', 'ringing'] as const)(
        'is refused while a timer is %s: one timer at a time',
        (kind) => {
            const from = {
                running: started(),
                paused: run([{ kind: 'pause', id: 't1', nowMs: MINUTE }], started()).state,
                ringing: run([{ kind: 'ring', nowMs: 90 * MINUTE }], started()).state,
            }[kind];

            expect(from.timer?.kind).toBe(kind);
            expect(() => reduceTimer(from, { ...START, id: 't2', nowMs: 0 })).toThrow(
                expect.toSatisfy(isTimerAlreadyActiveError),
            );
        },
    );
});

describe('pause and resume', () => {
    it('pause keeps the time left, and the clock moving on does not change it', () => {
        const paused = run([{ kind: 'pause', id: 't1', nowMs: 80 * MINUTE }], started()).state;

        expect(paused.timer).toMatchObject({ kind: 'paused', remainingMs: 10 * MINUTE });
        expect(timeLeftMs(paused.timer, 80 * MINUTE)).toBe(10 * MINUTE);
        expect(timeLeftMs(paused.timer, 200 * MINUTE)).toBe(10 * MINUTE);
    });

    it('resume ends at now plus the time that was left', () => {
        const remainingMs = 4_190_000;
        const startedAt = 90 * MINUTE - remainingMs;
        const paused = run([{ kind: 'pause', id: 't1', nowMs: startedAt }], started()).state;
        const resumed = run([{ kind: 'resume', id: 't1', nowMs: startedAt + 2 * MINUTE }], paused).state;

        expect(resumed.timer).toMatchObject({ kind: 'running', endsAt: startedAt + 2 * MINUTE + remainingMs });
        expect(timeLeftMs(resumed.timer, startedAt + 2 * MINUTE)).toBe(remainingMs);
    });

    it('a pause at or after the end is left to ring, because the ring is due', () => {
        const state = started();

        expect(reduceTimer(state, { kind: 'pause', id: 't1', nowMs: 90 * MINUTE })).toEqual({ state, events: [] });
    });
});

describe('ring', () => {
    it('does nothing one millisecond early, and rings once at the end instant', () => {
        const state = started();

        expect(reduceTimer(state, { kind: 'ring', nowMs: 90 * MINUTE - 1 })).toEqual({ state, events: [] });

        const rung = reduceTimer(state, { kind: 'ring', nowMs: 90 * MINUTE });

        expect(rung.state.timer).toMatchObject({ kind: 'ringing', endedAt: 90 * MINUTE });
        expect(rung.events).toEqual([{ kind: 'ended', id: 't1', run: 1 }]);
    });

    it('a second ring, from any source, emits nothing', () => {
        const once = reduceTimer(started(), { kind: 'ring', nowMs: 90 * MINUTE });
        const twice = reduceTimer(once.state, { kind: 'ring', nowMs: 91 * MINUTE });

        expect(twice).toEqual({ state: once.state, events: [] });
    });

    it('rings a timer that ended long ago when the app comes back, with the real end instant', () => {
        const rung = reduceTimer(started(), { kind: 'ring', nowMs: 200 * MINUTE });

        expect(rung.state.timer).toMatchObject({ kind: 'ringing', endedAt: 90 * MINUTE });
    });

    it('never moves a paused timer', () => {
        const paused = run([{ kind: 'pause', id: 't1', nowMs: MINUTE }], started()).state;

        expect(reduceTimer(paused, { kind: 'ring', nowMs: 500 * MINUTE })).toEqual({ state: paused, events: [] });
    });
});

describe('cancel and restore (Undo)', () => {
    it('cancel removes the timer and holds it for Undo', () => {
        const cancelled = run([{ kind: 'cancel', id: 't1', nowMs: MINUTE }], started()).state;

        expect(cancelled.timer).toBeUndefined();
        expect(cancelled.undo).toMatchObject({ kind: 'running', id: 't1' });
    });

    it('restores a running timer on its own end time: 240 s left, 5 s later, 235 s left', () => {
        const from = run([{ ...START, durationMs: 240 * SECOND, nowMs: 0 }]).state;
        const cancelled = run([{ kind: 'cancel', id: 't1', nowMs: 0 }], from).state;
        const restored = reduceTimer(cancelled, { kind: 'restore', nowMs: 5 * SECOND });

        expect(restored.state.timer).toMatchObject({ kind: 'running', endsAt: 240 * SECOND });
        expect(timeLeftMs(restored.state.timer, 5 * SECOND)).toBe(235 * SECOND);
        expect(restored.events).toEqual([]);
        expect(restored.state.undo).toBeUndefined();
    });

    it('restores a timer whose time has passed straight to ringing, with one ended', () => {
        const from = run([{ ...START, durationMs: 240 * SECOND, nowMs: 0 }]).state;
        const cancelled = run([{ kind: 'cancel', id: 't1', nowMs: 237 * SECOND }], from).state;
        const restored = reduceTimer(cancelled, { kind: 'restore', nowMs: 242 * SECOND });

        expect(restored.state.timer).toMatchObject({ kind: 'ringing', endedAt: 240 * SECOND });
        expect(restored.events).toEqual([{ kind: 'ended', id: 't1', run: 1 }]);
    });

    it('restores a paused timer paused, with the same time left', () => {
        const paused = run([{ kind: 'pause', id: 't1', nowMs: 88 * MINUTE }], started()).state;
        const cancelled = run([{ kind: 'cancel', id: 't1', nowMs: 89 * MINUTE }], paused).state;
        const restored = reduceTimer(cancelled, { kind: 'restore', nowMs: 99 * MINUTE });

        expect(restored.state.timer).toMatchObject({ kind: 'paused', remainingMs: 2 * MINUTE });
    });

    it('starting a new timer withdraws the held one, so Undo can never make a second timer', () => {
        const cancelled = run([{ kind: 'cancel', id: 't1', nowMs: MINUTE }], started()).state;
        const next = reduceTimer(cancelled, { ...START, id: 't2', nowMs: 2 * MINUTE });

        expect(next.state.undo).toBeUndefined();
        expect(reduceTimer(next.state, { kind: 'restore', nowMs: 3 * MINUTE }).state).toBe(next.state);
    });

    it('restore with nothing held, or while a timer exists, changes nothing', () => {
        expect(reduceTimer(NO_TIMER, { kind: 'restore', nowMs: 0 })).toEqual({ state: NO_TIMER, events: [] });

        const state = started();

        expect(reduceTimer(state, { kind: 'restore', nowMs: 0 })).toEqual({ state, events: [] });
    });

    it('cancel does not apply to a ringing timer: only stop ends it', () => {
        const ringing = run([{ kind: 'ring', nowMs: 90 * MINUTE }], started()).state;

        expect(reduceTimer(ringing, { kind: 'cancel', id: 't1', nowMs: 91 * MINUTE })).toEqual({
            state: ringing,
            events: [],
        });
    });
});

describe('addTime', () => {
    it('from ringing restarts the timer for the added time, as a new run, and it can ring again', () => {
        const ringing = run([{ kind: 'ring', nowMs: 90 * MINUTE }], started()).state;
        const added = reduceTimer(ringing, { kind: 'addTime', id: 't1', addMs: 5 * MINUTE, nowMs: 92 * MINUTE });

        expect(added.state.timer).toMatchObject({ kind: 'running', run: 2, endsAt: 97 * MINUTE });
        expect(added.events).toEqual([]);

        const again = reduceTimer(added.state, { kind: 'ring', nowMs: 97 * MINUTE });

        expect(again.events).toEqual([{ kind: 'ended', id: 't1', run: 2 }]);
    });

    it('from running pushes the end out by the added time, in the same run', () => {
        const added = reduceTimer(started(), { kind: 'addTime', id: 't1', addMs: 10 * MINUTE, nowMs: MINUTE });

        expect(added.state.timer).toMatchObject({ kind: 'running', run: 1, endsAt: 100 * MINUTE });
    });

    it('refuses a total past 24 hours and an added time outside the bounds', () => {
        const nearMax = run([{ ...START, durationMs: MAX_TIMER_MS - MINUTE, nowMs: 0 }]).state;

        expect(() => reduceTimer(nearMax, { kind: 'addTime', id: 't1', addMs: 5 * MINUTE, nowMs: 0 })).toThrow(
            expect.toSatisfy(isInvalidTimerDurationError),
        );
        expect(() => reduceTimer(started(), { kind: 'addTime', id: 't1', addMs: SECOND, nowMs: 0 })).toThrow(
            expect.toSatisfy(isInvalidTimerDurationError),
        );
    });

    it('does not apply to a paused timer', () => {
        const paused = run([{ kind: 'pause', id: 't1', nowMs: MINUTE }], started()).state;

        expect(reduceTimer(paused, { kind: 'addTime', id: 't1', addMs: 5 * MINUTE, nowMs: MINUTE })).toEqual({
            state: paused,
            events: [],
        });
    });
});

describe('stop', () => {
    it('removes a ringing timer, holds no Undo, and the offers can return', () => {
        const ringing = run([{ kind: 'ring', nowMs: 90 * MINUTE }], started()).state;
        const stopped = reduceTimer(ringing, { kind: 'stop', id: 't1', nowMs: 91 * MINUTE });

        expect(stopped.state).toEqual({ timer: undefined, undo: undefined });
        expect(stopped.events).toEqual([]);
    });

    it('does not apply to a running timer', () => {
        const state = started();

        expect(reduceTimer(state, { kind: 'stop', id: 't1', nowMs: MINUTE })).toEqual({ state, events: [] });
    });
});

describe('a command for another timer, or one that does not apply, changes nothing and never throws', () => {
    it.each<TimerCommand>([
        { kind: 'pause', id: 'other', nowMs: MINUTE },
        { kind: 'resume', id: 't1', nowMs: MINUTE },
        { kind: 'cancel', id: 'other', nowMs: MINUTE },
        { kind: 'addTime', id: 'other', addMs: 5 * MINUTE, nowMs: MINUTE },
        { kind: 'stop', id: 'other', nowMs: MINUTE },
    ])('$kind (id $id) on a running timer', (command) => {
        const state = started();

        expect(reduceTimer(state, command)).toEqual({ state, events: [] });
    });

    it('a pause while paused, and a resume while running', () => {
        const paused = run([{ kind: 'pause', id: 't1', nowMs: MINUTE }], started()).state;

        expect(reduceTimer(paused, { kind: 'pause', id: 't1', nowMs: 2 * MINUTE })).toEqual({
            state: paused,
            events: [],
        });
        expect(reduceTimer(started(), { kind: 'resume', id: 't1', nowMs: MINUTE }).events).toEqual([]);
    });

    it('every command on no timer', () => {
        for (const command of [
            { kind: 'pause', id: 't1', nowMs: 0 },
            { kind: 'resume', id: 't1', nowMs: 0 },
            { kind: 'cancel', id: 't1', nowMs: 0 },
            { kind: 'addTime', id: 't1', addMs: 5 * MINUTE, nowMs: 0 },
            { kind: 'ring', nowMs: 0 },
            { kind: 'stop', id: 't1', nowMs: 0 },
        ] as const) {
            expect(reduceTimer(NO_TIMER, command)).toEqual({ state: NO_TIMER, events: [] });
        }
    });
});

describe('time left', () => {
    it('is the end instant minus now, read from the clock and never counted down', () => {
        const { timer } = started(1_000);

        // Out of order and backwards on purpose: a counter that decremented per call would drift on these.
        expect(timeLeftMs(timer, 1_000 + 10 * MINUTE)).toBe(80 * MINUTE);
        expect(timeLeftMs(timer, 1_000 + 5 * MINUTE)).toBe(85 * MINUTE);
        expect(timeLeftMs(timer, 1_000 + 10 * MINUTE)).toBe(80 * MINUTE);
        expect(timeLeftMs(timer, 1_000 - MINUTE)).toBe(91 * MINUTE);
    });

    it('is never below zero, and zero for a ringing timer or none', () => {
        expect(timeLeftMs(started().timer, 999 * MINUTE)).toBe(0);
        expect(timeLeftMs(run([{ kind: 'ring', nowMs: 90 * MINUTE }], started()).state.timer, 0)).toBe(0);
        expect(timeLeftMs(undefined, 0)).toBe(0);
    });
});
