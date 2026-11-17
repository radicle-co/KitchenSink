/**
 * The timer list reducer, one command at a time. The whole model is a pure function of (state, command with its clock),
 * so every case names its instants and nothing waits. Rewritten in S6.U0 from the single-timer suite of S3a.U1: each
 * carried case keeps its mutant (the mapping table is in reviews/0005-U0.md), and the list cases are new.
 */
import { describe, expect, it } from 'vitest';

import { isInvalidTimerDurationError } from '../errors.js';
import {
    alarmQueue,
    MAX_TIMER_MS,
    MIN_TIMER_MS,
    NO_TIMER,
    reduceTimer,
    TIMER_LIMIT,
    timeLeftMs,
    timerOrder,
    type ActiveTimer,
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
    stepDigest: 's1:0000000d',
    name: 'Roast',
    durationMs: 90 * MINUTE,
    limit: TIMER_LIMIT,
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

/** The timer with this id, as the list holds it. */
const timerOf = (state: TimerState, id = 't1'): ActiveTimer | undefined => state.timers.find((t) => t.id === id);
const idsOf = (state: TimerState) => timerOrder(state).map((e) => (e.kind === 'live' ? e.timer.id : e.id));

const started = (nowMs = 0) => run([{ ...START, nowMs }]).state;
const pausedState = () => run([{ kind: 'pause', id: 't1', nowMs: MINUTE }], started()).state;
const ringingState = () => run([{ kind: 'ring', nowMs: 90 * MINUTE }], started()).state;

/** `n` running timers on step 3 of one recipe with limit 10, ids t1..tn, started one second apart. */
function many(n: number): TimerState {
    let state: TimerState = NO_TIMER;

    for (let i = 1; i <= n; i += 1) {
        state = reduceTimer(state, { ...START, id: `t${i}`, limit: 10, nowMs: i * SECOND }).state;
    }

    return state;
}

describe('start', () => {
    it('runs from the instant it was started, with a stable id, run 1, ordinal 1 and its step digest', () => {
        const state = started(1_000);

        expect(timerOf(state)).toEqual({
            kind: 'running',
            id: 't1',
            run: 1,
            recipeId: 'roast',
            stepIndex: 3,
            stepDigest: 's1:0000000d',
            ordinal: 1,
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
            expect(attempt().state.timers[0]?.kind).toBe('running');
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
        'at the limit (%s timer held) is a refusal in the result: same state, no events, no throw',
        (kind) => {
            const from = { running: started(), paused: pausedState(), ringing: ringingState() }[kind];

            expect(timerOf(from)?.kind).toBe(kind);

            const result = reduceTimer(from, { ...START, id: 't2', nowMs: 0 });

            expect(result).toEqual({ state: from, events: [], refused: 'limit' });
            expect(result.state).toBe(from);
        },
    );

    it('one under the limit starts a tenth timer, and exactly at it refuses (limit 10)', () => {
        const ten = reduceTimer(many(9), { ...START, id: 't10', limit: 10, nowMs: 10 * SECOND });

        expect(ten.state.timers).toHaveLength(10);
        expect(ten.refused).toBeUndefined();

        const eleven = reduceTimer(ten.state, { ...START, id: 't11', limit: 10, nowMs: 11 * SECOND });

        expect(eleven).toEqual({ state: ten.state, events: [], refused: 'limit' });
    });

    it('a start with an id already live is a quiet no-op: the same state object, no events, not a refusal', () => {
        const state = many(2);
        const again = reduceTimer(state, { ...START, id: 't1', limit: 10, nowMs: 9 * SECOND });

        expect(again.state).toBe(state);
        expect(again.events).toEqual([]);
        expect(again.refused).toBeUndefined();
    });

    it('a start with the id of the held Undo is a quiet no-op too', () => {
        const cancelled = reduceTimer(many(2), { kind: 'cancel', id: 't1', nowMs: 3 * SECOND }).state;
        const again = reduceTimer(cancelled, { ...START, id: 't1', limit: 10, nowMs: 4 * SECOND });

        expect(again.state).toBe(cancelled);
        expect(again.refused).toBeUndefined();
    });

    it('numbers timers on the same recipe and step 1, 2, 3, and fills the lowest free number', () => {
        let state = many(3);

        expect(state.timers.map((t) => t.ordinal)).toEqual([1, 2, 3]);

        state = reduceTimer(state, { kind: 'cancel', id: 't2', nowMs: 5 * SECOND }).state;
        state = reduceTimer(state, { kind: 'discardUndo', id: 't2', nowMs: 6 * SECOND }).state;
        state = reduceTimer(state, { ...START, id: 't4', limit: 10, nowMs: 7 * SECOND }).state;

        expect(timerOf(state, 't4')?.ordinal).toBe(2);
    });

    it('the held Undo keeps its number, so a new timer on its step does not take it', () => {
        const cancelled = reduceTimer(many(2), { kind: 'cancel', id: 't1', nowMs: 3 * SECOND }).state;
        const next = reduceTimer(cancelled, { ...START, id: 't3', limit: 10, nowMs: 4 * SECOND }).state;

        expect(timerOf(next, 't3')?.ordinal).toBe(3);
    });

    it('another step or another recipe numbers from 1 again', () => {
        let state = many(1);

        state = reduceTimer(state, { ...START, id: 'a', stepIndex: 4, limit: 10, nowMs: 2 * SECOND }).state;
        state = reduceTimer(state, { ...START, id: 'b', recipeId: 'other', limit: 10, nowMs: 3 * SECOND }).state;

        expect(timerOf(state, 'a')?.ordinal).toBe(1);
        expect(timerOf(state, 'b')?.ordinal).toBe(1);
    });
});

describe('pause and resume', () => {
    it('pause keeps the time left, and the clock moving on does not change it', () => {
        const paused = run([{ kind: 'pause', id: 't1', nowMs: 80 * MINUTE }], started()).state;

        expect(timerOf(paused)).toMatchObject({ kind: 'paused', remainingMs: 10 * MINUTE });
        expect(timeLeftMs(timerOf(paused), 80 * MINUTE)).toBe(10 * MINUTE);
        expect(timeLeftMs(timerOf(paused), 200 * MINUTE)).toBe(10 * MINUTE);
    });

    it('resume ends at now plus the time that was left', () => {
        const remainingMs = 4_190_000;
        const startedAt = 90 * MINUTE - remainingMs;
        const paused = run([{ kind: 'pause', id: 't1', nowMs: startedAt }], started()).state;
        const resumed = run([{ kind: 'resume', id: 't1', nowMs: startedAt + 2 * MINUTE }], paused).state;

        expect(timerOf(resumed)).toMatchObject({ kind: 'running', endsAt: startedAt + 2 * MINUTE + remainingMs });
        expect(timeLeftMs(timerOf(resumed), startedAt + 2 * MINUTE)).toBe(remainingMs);
    });

    it('a pause at or after the end is left to ring, because the ring is due', () => {
        const state = started();

        expect(reduceTimer(state, { kind: 'pause', id: 't1', nowMs: 90 * MINUTE })).toEqual({ state, events: [] });
    });

    it('pause changes only the timer named', () => {
        const state = many(3);
        const paused = reduceTimer(state, { kind: 'pause', id: 't2', nowMs: 5 * SECOND }).state;

        expect(timerOf(paused, 't1')).toBe(timerOf(state, 't1'));
        expect(timerOf(paused, 't3')).toBe(timerOf(state, 't3'));
        expect(timerOf(paused, 't2')?.kind).toBe('paused');
    });

    it('a pause or resume keeps the held Undo of another timer (only cancel, restore and discard touch it)', () => {
        const cancelled = reduceTimer(many(2), { kind: 'cancel', id: 't1', nowMs: 3 * SECOND }).state;
        const paused = reduceTimer(cancelled, { kind: 'pause', id: 't2', nowMs: 4 * SECOND }).state;
        const resumed = reduceTimer(paused, { kind: 'resume', id: 't2', nowMs: 5 * SECOND }).state;

        expect(paused.undo).toBe(cancelled.undo);
        expect(resumed.undo).toBe(cancelled.undo);
    });
});

describe('ring', () => {
    it('does nothing one millisecond early, and rings once at the end instant', () => {
        const state = started();
        const early = reduceTimer(state, { kind: 'ring', nowMs: 90 * MINUTE - 1 });

        expect(early).toEqual({ state, events: [] });
        expect(early.state).toBe(state);

        const rung = reduceTimer(state, { kind: 'ring', nowMs: 90 * MINUTE });

        expect(timerOf(rung.state)).toMatchObject({ kind: 'ringing', endedAt: 90 * MINUTE });
        expect(rung.events).toEqual([{ kind: 'ended', id: 't1', run: 1 }]);
    });

    it('a second ring, from any source, emits nothing and returns the same state', () => {
        const once = reduceTimer(started(), { kind: 'ring', nowMs: 90 * MINUTE });
        const twice = reduceTimer(once.state, { kind: 'ring', nowMs: 91 * MINUTE });

        expect(twice).toEqual({ state: once.state, events: [] });
        expect(twice.state).toBe(once.state);
    });

    it('rings a timer that ended long ago when the app comes back, with the real end instant', () => {
        const rung = reduceTimer(started(), { kind: 'ring', nowMs: 200 * MINUTE });

        expect(timerOf(rung.state)).toMatchObject({ kind: 'ringing', endedAt: 90 * MINUTE });
    });

    it('never moves a paused timer', () => {
        const paused = pausedState();

        expect(reduceTimer(paused, { kind: 'ring', nowMs: 500 * MINUTE })).toEqual({ state: paused, events: [] });
    });

    it('rings every due timer at once, one ended each, ordered by end instant then id', () => {
        const state = run([
            { ...START, id: 'b', durationMs: 10 * MINUTE, limit: 10, nowMs: 0 },
            { ...START, id: 'a', durationMs: 10 * MINUTE, limit: 10, nowMs: 0 },
            { ...START, id: 'c', durationMs: 5 * MINUTE, limit: 10, nowMs: 0 },
            { ...START, id: 'd', durationMs: 60 * MINUTE, limit: 10, nowMs: 0 },
        ]).state;
        const rung = reduceTimer(state, { kind: 'ring', nowMs: 30 * MINUTE });

        expect(rung.events).toEqual([
            { kind: 'ended', id: 'c', run: 1 },
            { kind: 'ended', id: 'a', run: 1 },
            { kind: 'ended', id: 'b', run: 1 },
        ]);
        expect(timerOf(rung.state, 'd')?.kind).toBe('running');
    });

    it('keeps the held Undo, and never touches an endedAway timer', () => {
        const away: ActiveTimer = {
            kind: 'endedAway',
            id: 'away',
            run: 1,
            recipeId: 'roast',
            stepIndex: 3,
            stepDigest: 's1:0000000d',
            ordinal: 2,
            name: undefined,
            durationMs: 10 * MINUTE,
            endedAt: MINUTE,
        };
        const cancelled = reduceTimer(many(2), { kind: 'cancel', id: 't1', nowMs: 3 * SECOND }).state;
        const state: TimerState = { ...cancelled, timers: [...cancelled.timers, away] };
        const rung = reduceTimer(state, { kind: 'ring', nowMs: 200 * MINUTE });

        expect(rung.state.undo).toBe(state.undo);
        expect(timerOf(rung.state, 'away')).toBe(away);
        expect(rung.events.map((e) => e.id)).toEqual(['t2']);
    });
});

describe('cancel and restore (Undo)', () => {
    it('cancel removes the timer and holds it for Undo', () => {
        const cancelled = run([{ kind: 'cancel', id: 't1', nowMs: MINUTE }], started()).state;

        expect(cancelled.timers).toEqual([]);
        expect(cancelled.undo).toMatchObject({ kind: 'running', id: 't1' });
    });

    it('a second cancel replaces the held timer: the first cancel is final', () => {
        const first = reduceTimer(many(2), { kind: 'cancel', id: 't1', nowMs: 3 * SECOND }).state;
        const second = reduceTimer(first, { kind: 'cancel', id: 't2', nowMs: 4 * SECOND }).state;

        expect(second.undo?.id).toBe('t2');
        expect(second.timers).toEqual([]);
    });

    it('restores a running timer on its own end time: 240 s left, 5 s later, 235 s left', () => {
        const from = run([{ ...START, durationMs: 240 * SECOND, nowMs: 0 }]).state;
        const cancelled = run([{ kind: 'cancel', id: 't1', nowMs: 0 }], from).state;
        const restored = reduceTimer(cancelled, { kind: 'restore', limit: TIMER_LIMIT, nowMs: 5 * SECOND });

        expect(timerOf(restored.state)).toMatchObject({ kind: 'running', endsAt: 240 * SECOND });
        expect(timeLeftMs(timerOf(restored.state), 5 * SECOND)).toBe(235 * SECOND);
        expect(restored.events).toEqual([]);
        expect(restored.state.undo).toBeUndefined();
    });

    it('restores a timer whose time has passed straight to ringing, with one ended', () => {
        const from = run([{ ...START, durationMs: 240 * SECOND, nowMs: 0 }]).state;
        const cancelled = run([{ kind: 'cancel', id: 't1', nowMs: 237 * SECOND }], from).state;
        const restored = reduceTimer(cancelled, { kind: 'restore', limit: TIMER_LIMIT, nowMs: 242 * SECOND });

        expect(timerOf(restored.state)).toMatchObject({ kind: 'ringing', endedAt: 240 * SECOND });
        expect(restored.events).toEqual([{ kind: 'ended', id: 't1', run: 1 }]);
    });

    it('restores a paused timer paused, with the same time left', () => {
        const paused = run([{ kind: 'pause', id: 't1', nowMs: 88 * MINUTE }], started()).state;
        const cancelled = run([{ kind: 'cancel', id: 't1', nowMs: 89 * MINUTE }], paused).state;
        const restored = reduceTimer(cancelled, { kind: 'restore', limit: TIMER_LIMIT, nowMs: 99 * MINUTE });

        expect(timerOf(restored.state)).toMatchObject({ kind: 'paused', remainingMs: 2 * MINUTE });
    });

    it('starting a new timer keeps the held one, and a restore beside it keeps its slot (limit 10)', () => {
        const cancelled = run([{ kind: 'cancel', id: 't1', nowMs: MINUTE }], started()).state;
        const next = reduceTimer(cancelled, { ...START, id: 't2', limit: 10, nowMs: 2 * MINUTE });

        expect(next.state.undo?.id).toBe('t1');

        const back = reduceTimer(next.state, { kind: 'restore', limit: 10, nowMs: 3 * MINUTE });

        expect(back.state.timers.map((t) => t.id).sort()).toEqual(['t1', 't2']);
        expect(back.state.undo).toBeUndefined();
    });

    it('restore at the limit is refused and the Undo stays, so the cook can free a slot and try again', () => {
        const cancelled = run([{ kind: 'cancel', id: 't1', nowMs: MINUTE }], started()).state;
        const next = reduceTimer(cancelled, { ...START, id: 't2', nowMs: 2 * MINUTE }).state;
        const refused = reduceTimer(next, { kind: 'restore', limit: TIMER_LIMIT, nowMs: 3 * MINUTE });

        expect(refused).toEqual({ state: next, events: [], refused: 'limit' });
        expect(refused.state.undo?.id).toBe('t1');
    });

    it('restore with nothing held changes nothing, and is not a refusal', () => {
        expect(reduceTimer(NO_TIMER, { kind: 'restore', limit: TIMER_LIMIT, nowMs: 0 })).toEqual({
            state: NO_TIMER,
            events: [],
        });
    });

    it('a restored timer keeps its number when it is free, and takes the lowest free one when it was taken', () => {
        const three = many(3);
        const cancelled = reduceTimer(three, { kind: 'cancel', id: 't2', nowMs: 5 * SECOND }).state;
        const kept = reduceTimer(cancelled, { kind: 'restore', limit: 10, nowMs: 6 * SECOND }).state;

        expect(timerOf(kept, 't2')?.ordinal).toBe(2);

        const third = three.timers[2];

        if (third === undefined) {
            throw new Error('many(3) builds three timers');
        }

        const intruder = { ...third, id: 'x', ordinal: 2 };
        const taken: TimerState = { timers: [...cancelled.timers, intruder], undo: cancelled.undo };
        const renumbered = reduceTimer(taken, { kind: 'restore', limit: 10, nowMs: 6 * SECOND }).state;

        expect(timerOf(renumbered, 't2')?.ordinal).toBe(4);
    });

    it('cancel does not apply to a ringing timer: only stop ends it', () => {
        const ringing = ringingState();

        expect(reduceTimer(ringing, { kind: 'cancel', id: 't1', nowMs: 91 * MINUTE })).toEqual({
            state: ringing,
            events: [],
        });
    });

    it('discardUndo clears the Undo only when the id matches', () => {
        const cancelled = run([{ kind: 'cancel', id: 't1', nowMs: MINUTE }], started()).state;

        expect(reduceTimer(cancelled, { kind: 'discardUndo', id: 'other', nowMs: MINUTE }).state).toBe(cancelled);
        expect(reduceTimer(cancelled, { kind: 'discardUndo', id: 't1', nowMs: MINUTE }).state).toEqual(NO_TIMER);
    });
});

describe('addTime', () => {
    it('from ringing restarts the timer for the added time, as a new run, and it can ring again', () => {
        const ringing = ringingState();
        const added = reduceTimer(ringing, { kind: 'addTime', id: 't1', addMs: 5 * MINUTE, nowMs: 92 * MINUTE });

        expect(timerOf(added.state)).toMatchObject({ kind: 'running', run: 2, endsAt: 97 * MINUTE });
        expect(added.events).toEqual([]);

        const again = reduceTimer(added.state, { kind: 'ring', nowMs: 97 * MINUTE });

        expect(again.events).toEqual([{ kind: 'ended', id: 't1', run: 2 }]);
    });

    it('from running pushes the end out by the added time, in the same run', () => {
        const added = reduceTimer(started(), { kind: 'addTime', id: 't1', addMs: 10 * MINUTE, nowMs: MINUTE });

        expect(timerOf(added.state)).toMatchObject({ kind: 'running', run: 1, endsAt: 100 * MINUTE });
    });

    it('from endedAway restarts as a new run, like ringing', () => {
        const away: ActiveTimer = {
            kind: 'endedAway',
            id: 'away',
            run: 3,
            recipeId: 'roast',
            stepIndex: 3,
            stepDigest: 's1:0000000d',
            ordinal: 1,
            name: undefined,
            durationMs: 10 * MINUTE,
            endedAt: MINUTE,
        };
        const added = reduceTimer(
            { timers: [away], undo: undefined },
            { kind: 'addTime', id: 'away', addMs: 5 * MINUTE, nowMs: 20 * MINUTE },
        );

        expect(timerOf(added.state, 'away')).toMatchObject({
            kind: 'running',
            run: 4,
            durationMs: 5 * MINUTE,
            endsAt: 25 * MINUTE,
        });
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

    it('refuses a running total past 24 hours even when the time left is small', () => {
        const longTimer = run([{ ...START, durationMs: MAX_TIMER_MS, nowMs: 0 }]).state;

        expect(() =>
            reduceTimer(longTimer, { kind: 'addTime', id: 't1', addMs: 60 * MINUTE, nowMs: 23 * 60 * MINUTE }),
        ).toThrow(expect.toSatisfy(isInvalidTimerDurationError));
    });

    it('accepts an added hour to a 23 hour timer 10 hours in, and the total stays within 24 hours', () => {
        const longTimer = run([{ ...START, durationMs: 23 * 60 * MINUTE, nowMs: 0 }]).state;
        const added = reduceTimer(longTimer, {
            kind: 'addTime',
            id: 't1',
            addMs: 60 * MINUTE,
            nowMs: 10 * 60 * MINUTE,
        });

        expect(timerOf(added.state)).toMatchObject({
            kind: 'running',
            durationMs: MAX_TIMER_MS,
            endsAt: 24 * 60 * MINUTE,
        });
    });

    it('refuses added time that takes the time left past 24 hours when the clock went back', () => {
        const started20h = run([{ ...START, durationMs: 20 * 60 * MINUTE, nowMs: 5 * 60 * MINUTE }]).state;

        // Time left is 25 h at now = 0 (the clock is 5 h behind the start), and 26 h with the hour added, while the
        // total (21 h) is within 24 h: only the time-left check refuses it.
        expect(() => reduceTimer(started20h, { kind: 'addTime', id: 't1', addMs: 60 * MINUTE, nowMs: 0 })).toThrow(
            expect.toSatisfy(isInvalidTimerDurationError),
        );
    });

    it('refuses 1 s added to a ringing timer, as it does from running', () => {
        const ringing = ringingState();

        expect(() => reduceTimer(ringing, { kind: 'addTime', id: 't1', addMs: SECOND, nowMs: 91 * MINUTE })).toThrow(
            expect.toSatisfy(isInvalidTimerDurationError),
        );
    });

    it('does not apply to a paused timer', () => {
        const paused = pausedState();

        expect(reduceTimer(paused, { kind: 'addTime', id: 't1', addMs: 5 * MINUTE, nowMs: MINUTE })).toEqual({
            state: paused,
            events: [],
        });
    });

    it('keeps the held Undo of another timer', () => {
        const cancelled = reduceTimer(many(2), { kind: 'cancel', id: 't1', nowMs: 3 * SECOND }).state;
        const added = reduceTimer(cancelled, { kind: 'addTime', id: 't2', addMs: 5 * MINUTE, nowMs: 4 * SECOND });

        expect(added.state.undo).toBe(cancelled.undo);
    });
});

describe('stop', () => {
    it('removes a ringing timer, holds no Undo, and the offers can return', () => {
        const ringing = ringingState();
        const stopped = reduceTimer(ringing, { kind: 'stop', id: 't1', nowMs: 91 * MINUTE });

        expect(stopped.state).toEqual({ timers: [], undo: undefined });
        expect(stopped.events).toEqual([]);
    });

    it('does not apply to a running timer', () => {
        const state = started();

        expect(reduceTimer(state, { kind: 'stop', id: 't1', nowMs: MINUTE })).toEqual({ state, events: [] });
    });

    it('removes only the timer named, and keeps the Undo of another', () => {
        const cancelled = reduceTimer(many(3), { kind: 'cancel', id: 't1', nowMs: 5 * SECOND }).state;
        const rung = reduceTimer(cancelled, { kind: 'ring', nowMs: 200 * MINUTE }).state;
        const stopped = reduceTimer(rung, { kind: 'stop', id: 't2', nowMs: 201 * MINUTE }).state;

        expect(stopped.timers.map((t) => t.id)).toEqual(['t3']);
        expect(stopped.undo).toBe(cancelled.undo);
    });
});

describe('a command for another timer, or one that does not apply, changes nothing and never throws', () => {
    it('resume naming another timer leaves a paused timer paused', () => {
        const paused = pausedState();

        expect(reduceTimer(paused, { kind: 'resume', id: 'other', nowMs: 2 * MINUTE })).toEqual({
            state: paused,
            events: [],
        });
    });

    it('stop naming another timer leaves a ringing timer ringing', () => {
        const ringing = ringingState();

        expect(reduceTimer(ringing, { kind: 'stop', id: 'other', nowMs: 91 * MINUTE })).toEqual({
            state: ringing,
            events: [],
        });
    });

    it.each([90 * MINUTE, 91 * MINUTE])(
        'addTime on a running timer at or past its end (now %i) is left for ring',
        (nowMs) => {
            const state = started();

            expect(reduceTimer(state, { kind: 'addTime', id: 't1', addMs: 5 * MINUTE, nowMs })).toEqual({
                state,
                events: [],
            });
        },
    );

    it.each<TimerCommand>([
        { kind: 'pause', id: 'other', nowMs: MINUTE },
        { kind: 'resume', id: 't1', nowMs: MINUTE },
        { kind: 'cancel', id: 'other', nowMs: MINUTE },
        { kind: 'addTime', id: 'other', addMs: 5 * MINUTE, nowMs: MINUTE },
        { kind: 'stop', id: 'other', nowMs: MINUTE },
        { kind: 'discardUndo', id: 'other', nowMs: MINUTE },
    ])('$kind (id $id) on a running timer', (command) => {
        const state = started();
        const result = reduceTimer(state, command);

        expect(result).toEqual({ state, events: [] });
        expect(result.state).toBe(state);
    });

    it('a pause while paused, and a resume while running', () => {
        const paused = pausedState();

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
            { kind: 'discardUndo', id: 't1', nowMs: 0 },
            { kind: 'rematch', moves: [], nowMs: 0 },
        ] as const) {
            expect(reduceTimer(NO_TIMER, command)).toEqual({ state: NO_TIMER, events: [] });
        }
    });
});

describe('restore at the end instant', () => {
    it('a timer cancelled with 1 ms left and restored exactly at its end comes back ringing, once', () => {
        const cancelled = run([{ kind: 'cancel', id: 't1', nowMs: 90 * MINUTE - 1 }], started()).state;
        const restored = reduceTimer(cancelled, { kind: 'restore', limit: TIMER_LIMIT, nowMs: 90 * MINUTE });

        expect(timerOf(restored.state)).toMatchObject({ kind: 'ringing', endedAt: 90 * MINUTE });
        expect(restored.events).toEqual([{ kind: 'ended', id: 't1', run: 1 }]);
    });
});

describe('a clock that goes backwards', () => {
    it('never pauses a timer with more time left than its length', () => {
        const paused = run([{ kind: 'pause', id: 't1', nowMs: -100 * MINUTE }], started()).state;

        expect(timerOf(paused)).toMatchObject({ kind: 'paused', remainingMs: 90 * MINUTE });
    });
});

describe('rematch (the step rewrite as one reducer command)', () => {
    const digest = (n: string) => `s1:${n.padStart(8, '0')}`;

    /** Two timers on old steps 3 and 4 of one recipe, both number 1. */
    const twoSteps = () =>
        run([
            { ...START, id: 'on3', stepIndex: 3, stepDigest: digest('3'), limit: 10, nowMs: 0 },
            { ...START, id: 'on4', stepIndex: 4, stepDigest: digest('4'), limit: 10, nowMs: 0 },
        ]).state;

    it('step 3 is deleted: the timer that kept its step by content keeps number 1, the other takes 2, a new start 3', () => {
        // Step 4's text is now at index 3; the deleted step 3 falls back to the clamped index 3 with that step's digest.
        const moved = reduceTimer(twoSteps(), {
            kind: 'rematch',
            moves: [
                { id: 'on4', stepIndex: 3, stepDigest: digest('4') },
                { id: 'on3', stepIndex: 3, stepDigest: digest('4') },
            ],
            nowMs: SECOND,
        }).state;

        // on4's stored digest equals the move's: it kept its step. on3's did not: it fell back.
        expect(timerOf(moved, 'on4')).toMatchObject({ stepIndex: 3, ordinal: 1 });
        expect(timerOf(moved, 'on3')).toMatchObject({ stepIndex: 3, ordinal: 2 });

        const next = reduceTimer(moved, { ...START, id: 'new', stepIndex: 3, limit: 10, nowMs: 2 * SECOND }).state;

        expect(timerOf(next, 'new')?.ordinal).toBe(3);
    });

    it('a timer that falls back onto a free number keeps its own number', () => {
        const state = run([{ ...START, id: 'only', stepIndex: 3, stepDigest: digest('3'), limit: 10, nowMs: 0 }]).state;
        const moved = reduceTimer(state, {
            kind: 'rematch',
            moves: [{ id: 'only', stepIndex: 2, stepDigest: digest('9') }],
            nowMs: SECOND,
        }).state;

        expect(timerOf(moved, 'only')).toMatchObject({ stepIndex: 2, stepDigest: digest('9'), ordinal: 1 });
    });

    it('the held Undo is rehomed too, and its new step digest is the move', () => {
        const cancelled = reduceTimer(twoSteps(), { kind: 'cancel', id: 'on3', nowMs: SECOND }).state;
        const moved = reduceTimer(cancelled, {
            kind: 'rematch',
            moves: [{ id: 'on3', stepIndex: 1, stepDigest: digest('1') }],
            nowMs: 2 * SECOND,
        }).state;

        expect(moved.undo).toMatchObject({ id: 'on3', stepIndex: 1, stepDigest: digest('1') });
    });

    it('a move for an unknown id is ignored, and moves that change nothing return the same state object', () => {
        const state = twoSteps();

        expect(
            reduceTimer(state, {
                kind: 'rematch',
                moves: [{ id: 'ghost', stepIndex: 0, stepDigest: digest('0') }],
                nowMs: SECOND,
            }).state,
        ).toBe(state);
        expect(
            reduceTimer(state, {
                kind: 'rematch',
                moves: [{ id: 'on3', stepIndex: 3, stepDigest: digest('3') }],
                nowMs: SECOND,
            }).state,
        ).toBe(state);
    });

    it('keeps the Undo id, and every timer kind, as it was', () => {
        const cancelled = reduceTimer(twoSteps(), { kind: 'cancel', id: 'on3', nowMs: SECOND }).state;
        const moved = reduceTimer(cancelled, {
            kind: 'rematch',
            moves: [{ id: 'on4', stepIndex: 1, stepDigest: digest('1') }],
            nowMs: 2 * SECOND,
        }).state;

        expect(moved.undo?.id).toBe('on3');
        expect(timerOf(moved, 'on4')?.kind).toBe('running');
    });
});

describe('timerOrder and alarmQueue', () => {
    it('orders ringing first by end instant, then running by end instant, then paused by time left, ties by id', () => {
        const state = run([
            { ...START, id: 'run2', durationMs: 20 * MINUTE, limit: 10, nowMs: 0 },
            { ...START, id: 'run1', durationMs: 10 * MINUTE, limit: 10, nowMs: 0 },
            { ...START, id: 'pa', durationMs: 30 * MINUTE, limit: 10, nowMs: 0 },
            { ...START, id: 'pb', durationMs: 30 * MINUTE, limit: 10, nowMs: 0 },
            { ...START, id: 'ring', durationMs: MINUTE, limit: 10, nowMs: 0 },
            { kind: 'pause', id: 'pa', nowMs: 5 * MINUTE },
            { kind: 'pause', id: 'pb', nowMs: 5 * MINUTE },
            { kind: 'ring', nowMs: 2 * MINUTE },
        ]).state;

        expect(idsOf(state)).toEqual(['ring', 'run1', 'run2', 'pa', 'pb']);
    });

    it('breaks a tie by code-unit order of the id, not by locale', () => {
        const state = run([
            { ...START, id: 'b', limit: 10, nowMs: 0 },
            { ...START, id: 'B', limit: 10, nowMs: 0 },
            { ...START, id: 'a', limit: 10, nowMs: 0 },
        ]).state;

        expect(idsOf(state)).toEqual(['B', 'a', 'b']);
    });

    it('reports a cancelled middle timer as held in its old slot, and restoring gives the same order as live', () => {
        const cancelled = reduceTimer(many(3), { kind: 'cancel', id: 't2', nowMs: 5 * SECOND }).state;

        expect(timerOrder(cancelled).map((e) => e.kind)).toEqual(['live', 'held', 'live']);
        expect(idsOf(cancelled)).toEqual(['t1', 't2', 't3']);

        const restored = reduceTimer(cancelled, { kind: 'restore', limit: 10, nowMs: 6 * SECOND }).state;

        expect(idsOf(restored)).toEqual(['t1', 't2', 't3']);
        expect(timerOrder(restored).every((e) => e.kind === 'live')).toBe(true);
    });

    it('alarmQueue holds only the ringing timers, by end instant then id', () => {
        const state = run([
            { ...START, id: 'b', durationMs: 10 * MINUTE, limit: 10, nowMs: 0 },
            { ...START, id: 'a', durationMs: 10 * MINUTE, limit: 10, nowMs: 0 },
            { ...START, id: 'c', durationMs: 5 * MINUTE, limit: 10, nowMs: 0 },
            { ...START, id: 'd', durationMs: 60 * MINUTE, limit: 10, nowMs: 0 },
            { kind: 'ring', nowMs: 30 * MINUTE },
        ]).state;

        expect(alarmQueue(state).map((t) => t.id)).toEqual(['c', 'a', 'b']);
        expect(alarmQueue(NO_TIMER)).toEqual([]);
    });
});

describe('numbering and order edges', () => {
    const runningBase = {
        kind: 'running',
        run: 1,
        recipeId: 'roast',
        stepIndex: 3,
        stepDigest: 's1:0000000d',
        ordinal: 1,
        name: undefined,
        durationMs: 10 * MINUTE,
        endsAt: 10 * MINUTE,
    } as const;
    const away = (id: string, endedAt: number): ActiveTimer => ({
        kind: 'endedAway',
        id,
        run: 1,
        recipeId: 'roast',
        stepIndex: 3,
        stepDigest: 's1:0000000d',
        ordinal: 1,
        name: undefined,
        durationMs: 10 * MINUTE,
        endedAt,
    });
    const permutations = <T>(items: readonly T[]): T[][] =>
        items.length <= 1
            ? [[...items]]
            : items.flatMap((item, i) =>
                  permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]),
              );

    it('orders equal keys by code unit whatever order they were stored in', () => {
        for (const ids of permutations(['B', 'a', 'b', 'c'])) {
            const state: TimerState = {
                timers: ids.map((id, i) => ({ ...runningBase, id, ordinal: i + 1 })),
                undo: undefined,
            };

            expect(idsOf(state)).toEqual(['B', 'a', 'b', 'c']);
        }
    });

    it('puts an endedAway timer with the ringing group, ahead of running, and orders running by end instant', () => {
        const state: TimerState = {
            timers: [
                { ...runningBase, id: 'late', endsAt: 100 * MINUTE, ordinal: 1 },
                { ...runningBase, id: 'soon', endsAt: 50 * MINUTE, ordinal: 2 },
                away('gone', MINUTE),
            ],
            undo: undefined,
        };

        expect(idsOf(state)).toEqual(['gone', 'soon', 'late']);
    });

    it('stop removes an endedAway timer', () => {
        const state: TimerState = { timers: [away('gone', MINUTE)], undo: undefined };

        expect(reduceTimer(state, { kind: 'stop', id: 'gone', nowMs: 2 * MINUTE }).state.timers).toEqual([]);
    });

    it('cancel does not apply to an endedAway timer', () => {
        const state: TimerState = { timers: [away('gone', MINUTE)], undo: undefined };

        expect(reduceTimer(state, { kind: 'cancel', id: 'gone', nowMs: 2 * MINUTE }).state).toBe(state);
    });

    it('cancel holds a paused timer for Undo, as paused', () => {
        const cancelled = reduceTimer(pausedState(), { kind: 'cancel', id: 't1', nowMs: 2 * MINUTE }).state;

        expect(cancelled.timers).toEqual([]);
        expect(cancelled.undo).toMatchObject({ kind: 'paused', id: 't1' });
    });

    it('rematch keeps a number that is not the lowest free one on a step that already holds another number', () => {
        const state: TimerState = {
            timers: [
                { ...runningBase, id: 'b', stepIndex: 1, stepDigest: 's1:00000001', ordinal: 1 },
                { ...runningBase, id: 'a', stepIndex: 3, stepDigest: 's1:00000003', ordinal: 3 },
            ],
            undo: undefined,
        };
        const moved = reduceTimer(state, {
            kind: 'rematch',
            moves: [{ id: 'a', stepIndex: 1, stepDigest: 's1:00000001' }],
            nowMs: 0,
        }).state;

        expect(timerOf(moved, 'a')?.ordinal).toBe(3);
        expect(timerOf(moved, 'b')?.ordinal).toBe(1);
    });

    it('rematch keeps a number on a step that another step shares it with (numbers belong to a step)', () => {
        const state: TimerState = {
            timers: [
                { ...runningBase, id: 'b', stepIndex: 4, stepDigest: 's1:00000004', ordinal: 2 },
                { ...runningBase, id: 'a', stepIndex: 3, stepDigest: 's1:00000003', ordinal: 2 },
            ],
            undo: undefined,
        };
        const moved = reduceTimer(state, {
            kind: 'rematch',
            moves: [{ id: 'a', stepIndex: 1, stepDigest: 's1:00000001' }],
            nowMs: 0,
        }).state;

        expect(timerOf(moved, 'a')?.ordinal).toBe(2);
        expect(timerOf(moved, 'b')?.ordinal).toBe(2);
    });

    it('restore keeps a free number even when it is not the lowest free one', () => {
        const state: TimerState = {
            timers: [{ ...runningBase, id: 'a', ordinal: 1 }],
            undo: { ...runningBase, id: 'held', ordinal: 3 },
        };

        expect(timerOf(reduceTimer(state, { kind: 'restore', limit: 10, nowMs: 0 }).state, 'held')?.ordinal).toBe(3);
    });

    it('restore ignores a taken number on another step or recipe', () => {
        const state: TimerState = {
            timers: [
                { ...runningBase, id: 'a', stepIndex: 4, ordinal: 2 },
                { ...runningBase, id: 'b', recipeId: 'other', ordinal: 2 },
            ],
            undo: { ...runningBase, id: 'held', ordinal: 2 },
        };

        expect(timerOf(reduceTimer(state, { kind: 'restore', limit: 10, nowMs: 0 }).state, 'held')?.ordinal).toBe(2);
    });

    it('rematch applies a move that changes only the index, and one that changes only the digest', () => {
        const state: TimerState = { timers: [{ ...runningBase, id: 'a' }], undo: undefined };
        const index = reduceTimer(state, {
            kind: 'rematch',
            moves: [{ id: 'a', stepIndex: 5, stepDigest: 's1:0000000d' }],
            nowMs: 0,
        }).state;
        const digest = reduceTimer(state, {
            kind: 'rematch',
            moves: [{ id: 'a', stepIndex: 3, stepDigest: 's1:000000ff' }],
            nowMs: 0,
        }).state;

        expect(timerOf(index, 'a')).toMatchObject({ stepIndex: 5, stepDigest: 's1:0000000d' });
        expect(timerOf(digest, 'a')).toMatchObject({ stepIndex: 3, stepDigest: 's1:000000ff' });
    });

    it('rematch keeps a number that is not the lowest free one, and breaks an equal-number tie by id', () => {
        const alone: TimerState = { timers: [{ ...runningBase, id: 'a', ordinal: 3 }], undo: undefined };
        const moved = reduceTimer(alone, {
            kind: 'rematch',
            moves: [{ id: 'a', stepIndex: 1, stepDigest: 's1:00000001' }],
            nowMs: 0,
        }).state;

        expect(timerOf(moved, 'a')?.ordinal).toBe(3);

        const two: TimerState = {
            timers: [
                { ...runningBase, id: 'b', stepIndex: 4, stepDigest: 's1:00000004' },
                { ...runningBase, id: 'a', stepIndex: 3, stepDigest: 's1:00000003' },
            ],
            undo: undefined,
        };
        const together = reduceTimer(two, {
            kind: 'rematch',
            moves: [
                { id: 'a', stepIndex: 5, stepDigest: 's1:00000003' },
                { id: 'b', stepIndex: 5, stepDigest: 's1:00000004' },
            ],
            nowMs: 0,
        }).state;

        expect(timerOf(together, 'a')?.ordinal).toBe(1);
        expect(timerOf(together, 'b')?.ordinal).toBe(2);
    });
});

describe('the state survives a JSON round trip (a later release stores it)', () => {
    it.each([
        ['running', () => started()],
        ['paused', () => pausedState()],
        ['ringing', () => ringingState()],
        ['a held Undo beside no timer', () => run([{ kind: 'cancel', id: 't1', nowMs: MINUTE }], started()).state],
        ['ten timers', () => many(10)],
    ])('%s', (_label, build) => {
        const state = build();

        expect(JSON.parse(JSON.stringify(state))).toEqual(state);
    });
});

describe('time left', () => {
    it('is the end instant minus now, read from the clock and never counted down', () => {
        const timer = timerOf(started(1_000));

        // Out of order and backwards on purpose: a counter that decremented per call would drift on these.
        expect(timeLeftMs(timer, 1_000 + 10 * MINUTE)).toBe(80 * MINUTE);
        expect(timeLeftMs(timer, 1_000 + 5 * MINUTE)).toBe(85 * MINUTE);
        expect(timeLeftMs(timer, 1_000 + 10 * MINUTE)).toBe(80 * MINUTE);
        expect(timeLeftMs(timer, 1_000 - MINUTE)).toBe(91 * MINUTE);
    });

    it('is never below zero, and zero for a ringing timer or none', () => {
        expect(timeLeftMs(timerOf(started()), 999 * MINUTE)).toBe(0);
        expect(timeLeftMs(timerOf(ringingState()), 0)).toBe(0);
        expect(timeLeftMs(undefined, 0)).toBe(0);
    });
});
