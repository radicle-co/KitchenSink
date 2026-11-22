/**
 * An offered timer records the line that offered it, as an index into its step's lines, never the line's text. The
 * reducer is the one owner of keeping or forgetting that index: a step whose text changed no longer has that line.
 */
import { describe, expect, it } from 'vitest';

import { NO_TIMER, reduceTimer, type TimerOrigin, type TimerState } from '../timer.js';

const digest = (n: string) => `s1:${n.padStart(8, '0')}`;
const START = {
    kind: 'start',
    id: 't1',
    recipeId: 'roast',
    stepIndex: 3,
    stepDigest: digest('3'),
    label: undefined,
    origin: { kind: 'offer', lineIndex: 1 },
    durationMs: 600_000,
    limit: 10,
    nowMs: 0,
} as const;

const originOf = (state: TimerState, id = 't1'): TimerOrigin | undefined =>
    [...state.timers, ...(state.undo === undefined ? [] : [state.undo])].find((timer) => timer.id === id)?.origin;

describe('the offering line of an offered timer', () => {
    it('is stored from the start and survives a pause, a resume, and +time', () => {
        let state = reduceTimer(NO_TIMER, START).state;

        state = reduceTimer(state, { kind: 'pause', id: 't1', run: 1, nowMs: 1_000 }).state;
        state = reduceTimer(state, { kind: 'resume', id: 't1', run: 1, nowMs: 2_000 }).state;
        state = reduceTimer(state, { kind: 'addTime', id: 't1', run: 1, addMs: 60_000, nowMs: 3_000 }).state;

        expect(originOf(state)).toEqual({ kind: 'offer', lineIndex: 1 });
    });

    it('is kept by a rematch when the timer kept its step (same digest), even if the step moved', () => {
        const state = reduceTimer(NO_TIMER, START).state;
        const moved = reduceTimer(state, {
            kind: 'rematch',
            moves: [{ id: 't1', stepIndex: 1, stepDigest: digest('3') }],
            nowMs: 1_000,
        }).state;

        expect(originOf(moved)).toEqual({ kind: 'offer', lineIndex: 1 });
    });

    it('becomes unknown (null) when the step text changed, so an old index never names another line', () => {
        const state = reduceTimer(NO_TIMER, START).state;
        const moved = reduceTimer(state, {
            kind: 'rematch',
            moves: [{ id: 't1', stepIndex: 3, stepDigest: digest('9') }],
            nowMs: 1_000,
        }).state;

        expect(originOf(moved)).toEqual({ kind: 'offer', lineIndex: null });
    });

    it('is forgotten on the held Undo timer too', () => {
        const started = reduceTimer(NO_TIMER, START).state;
        const cancelled = reduceTimer(started, { kind: 'cancel', id: 't1', run: 1, nowMs: 1_000 }).state;
        const moved = reduceTimer(cancelled, {
            kind: 'rematch',
            moves: [{ id: 't1', stepIndex: 3, stepDigest: digest('9') }],
            nowMs: 2_000,
        }).state;

        expect(originOf(moved)).toEqual({ kind: 'offer', lineIndex: null });
    });

    it('leaves an added timer as it was when its step text changed', () => {
        const state = reduceTimer(NO_TIMER, { ...START, origin: { kind: 'added' } }).state;
        const moved = reduceTimer(state, {
            kind: 'rematch',
            moves: [{ id: 't1', stepIndex: 3, stepDigest: digest('9') }],
            nowMs: 1_000,
        }).state;

        expect(originOf(moved)).toEqual({ kind: 'added' });
    });
});
