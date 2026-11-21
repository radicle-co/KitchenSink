/**
 * The two commands the kept record needs: `settleAway` is the restore rule, and `readmit` brings a
 * list of kept timers back (Undo of End). Both are pure functions of (state, command with its clock).
 */
import { describe, expect, it } from 'vitest';

import {
    NO_TIMER,
    reduceTimer,
    type ActiveTimer,
    type EndedAwayTimer,
    type PausedTimer,
    type RingingTimer,
    type RunningTimer,
    type TimerState,
} from '../timer.js';

const MINUTE = 60_000;
const BASE = {
    run: 1,
    recipeId: 'roast',
    stepIndex: 3,
    stepDigest: 's1:0000000d',
    label: undefined,
    origin: 'added',
} as const;

const running = (id: string, endsAt: number, over: Partial<RunningTimer> = {}): RunningTimer => ({
    ...BASE,
    id,
    ordinal: 1,
    durationMs: 10 * MINUTE,
    kind: 'running',
    endsAt,
    ...over,
});
const paused = (id: string, over: Partial<PausedTimer> = {}): PausedTimer => ({
    ...BASE,
    id,
    ordinal: 1,
    durationMs: 10 * MINUTE,
    kind: 'paused',
    remainingMs: 4 * MINUTE,
    ...over,
});
const ringing = (id: string, endedAt: number): RingingTimer => ({
    ...BASE,
    id,
    ordinal: 1,
    durationMs: 10 * MINUTE,
    kind: 'ringing',
    endedAt,
});
const endedAway = (id: string, endedAt: number): EndedAwayTimer => ({
    ...BASE,
    id,
    ordinal: 1,
    durationMs: 10 * MINUTE,
    kind: 'endedAway',
    endedAt,
});
const stateOf = (timers: readonly ActiveTimer[], undo: TimerState['undo'] = undefined): TimerState => ({
    timers,
    undo,
});

describe('settleAway', () => {
    const NOW = 100 * MINUTE;

    it('turns a running timer past its end into endedAway at its own end, with no event', () => {
        const result = reduceTimer(stateOf([running('t1', 90 * MINUTE)]), {
            kind: 'settleAway',
            heldElsewhere: false,
            nowMs: NOW,
        });

        expect(result.state.timers).toEqual([endedAway('t1', 90 * MINUTE)]);
        expect(result.events).toEqual([]);
    });

    it('turns a ringing timer into endedAway at the instant it ended, with no event', () => {
        const result = reduceTimer(stateOf([ringing('t1', 95 * MINUTE)]), {
            kind: 'settleAway',
            heldElsewhere: false,
            nowMs: NOW,
        });

        expect(result.state.timers).toEqual([endedAway('t1', 95 * MINUTE)]);
        expect(result.events).toEqual([]);
    });

    it('keeps a running timer that ends later, a paused one and an endedAway one, and returns the same state object', () => {
        const state = stateOf([
            running('t1', 110 * MINUTE),
            paused('t2', { ordinal: 2 }),
            endedAway('t3', 50 * MINUTE),
        ]);
        const result = reduceTimer(state, { kind: 'settleAway', heldElsewhere: false, nowMs: NOW });

        expect(result.state).toBe(state);
        expect(result.events).toEqual([]);
    });

    it('never settles by ring first: a due timer is not ringing on the way, so no ended event is raised', () => {
        const result = reduceTimer(stateOf([running('t1', 90 * MINUTE), running('t2', 99 * MINUTE, { ordinal: 2 })]), {
            kind: 'settleAway',
            heldElsewhere: false,
            nowMs: NOW,
        });

        expect(result.state.timers.map((t) => t.kind)).toEqual(['endedAway', 'endedAway']);
        expect(result.events).toEqual([]);
    });

    it('another tab of this cook alive (the presence lock): a due timer rings, a ringing one stays, no event', () => {
        const result = reduceTimer(stateOf([running('t1', 90 * MINUTE), ringing('t2', 95 * MINUTE)]), {
            kind: 'settleAway',
            heldElsewhere: true,
            nowMs: NOW,
        });

        expect(result.state.timers).toEqual([ringing('t1', 90 * MINUTE), ringing('t2', 95 * MINUTE)]);
        expect(result.events).toEqual([]);
    });

    it('leaves the held Undo as it was', () => {
        const held = running('u1', 50 * MINUTE);
        const result = reduceTimer(stateOf([running('t1', 90 * MINUTE)], held), {
            kind: 'settleAway',
            heldElsewhere: false,
            nowMs: NOW,
        });

        expect(result.state.undo).toBe(held);
    });

    it('a running timer exactly at its end is ended', () => {
        const result = reduceTimer(stateOf([running('t1', NOW)]), {
            kind: 'settleAway',
            heldElsewhere: false,
            nowMs: NOW,
        });

        expect(result.state.timers).toEqual([endedAway('t1', NOW)]);
    });
});

describe('readmit (a list comes back through the same admit step as restore)', () => {
    const NOW = 10 * MINUTE;
    const readmit = (state: TimerState, timers: readonly ActiveTimer[], limit = 10) =>
        reduceTimer(state, { kind: 'readmit', timers, limit, nowMs: NOW });

    it('adds the timers with their state as they were', () => {
        const back = [running('t1', 30 * MINUTE), paused('t2', { ordinal: 2 }), endedAway('t3', MINUTE)].map(
            (t, i) => ({
                ...t,
                ordinal: i + 1,
            }),
        ) as ActiveTimer[];
        const result = readmit(NO_TIMER, back);

        expect(result.state.timers).toEqual(back);
        expect(result.events).toEqual([]);
    });

    it('is refused whole past the limit: nothing is added, and the state is the one given', () => {
        const state = stateOf([running('a', 30 * MINUTE)]);
        const result = readmit(state, [running('t1', 30 * MINUTE), paused('t2', { ordinal: 2 })], 2);

        expect(result.refused).toBe('limit');
        expect(result.state).toBe(state);
    });

    it('is allowed exactly at the limit', () => {
        const result = readmit(stateOf([running('a', 30 * MINUTE, { stepIndex: 1 })]), [running('t1', 30 * MINUTE)], 2);

        expect(result.refused).toBeUndefined();
        expect(result.state.timers.map((t) => t.id)).toEqual(['a', 't1']);
    });

    it('skips a timer whose id is already held, so a double dispatch adds it once', () => {
        const state = stateOf([running('t1', 30 * MINUTE)]);
        const result = readmit(state, [running('t1', 30 * MINUTE)], 1);

        expect(result.state.timers).toHaveLength(1);
        expect(result.refused).toBeUndefined();
    });

    it('does not count a skipped timer against the limit', () => {
        const result = readmit(stateOf([running('t1', 30 * MINUTE)]), [running('t1', 30 * MINUTE)], 1);

        expect(result.refused).toBeUndefined();
    });

    it('on an ordinal clash takes the lowest free number, and the held Undo counts', () => {
        const held = paused('u1', { ordinal: 2 });
        const state = stateOf([running('a', 30 * MINUTE, { ordinal: 1 })], held);
        const result = readmit(state, [running('t1', 30 * MINUTE, { ordinal: 1 })]);
        const added = result.state.timers.find((t) => t.id === 't1');

        expect(added?.ordinal).toBe(3);
        expect(result.state.undo).toBe(held);
    });

    it('keeps the number when it is free', () => {
        const result = readmit(stateOf([running('a', 30 * MINUTE, { ordinal: 1 })]), [
            running('t1', 30 * MINUTE, { ordinal: 2 }),
        ]);

        expect(result.state.timers.find((t) => t.id === 't1')?.ordinal).toBe(2);
    });

    it('brings a running timer past its end back ringing, with one ended event', () => {
        const result = readmit(NO_TIMER, [running('t1', 5 * MINUTE)]);

        expect(result.state.timers).toEqual([ringing('t1', 5 * MINUTE)]);
        expect(result.events).toEqual([{ kind: 'ended', id: 't1', run: 1 }]);
    });

    it('settles the list first, so a timer already due in it rings before the new ones come in', () => {
        const result = readmit(stateOf([running('a', 2 * MINUTE, { stepIndex: 1 })]), [paused('t1')]);

        expect(result.state.timers.map((t) => t.kind)).toEqual(['ringing', 'paused']);
        expect(result.events).toEqual([{ kind: 'ended', id: 'a', run: 1 }]);
    });
});
