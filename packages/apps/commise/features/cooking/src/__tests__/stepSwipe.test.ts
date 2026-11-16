/**
 * The step swipe rule: on a touch screen a swipe on the step body is an extra route between steps. It never does what
 * only a button may do, because exiting and finishing lose the place: it does not exit on step 1 and does not finish on
 * the last step. It ignores a gesture that starts in a screen-edge zone, where iOS's back swipe and Android's gesture
 * Back live (the cooking route turns the iOS one off, and a body handler must not turn it back on).
 */
import { describe, expect, it } from 'vitest';

import { STEP_SWIPE_EDGE_DP, STEP_SWIPE_MIN_TRAVEL_DP, stepSwipeOf, swipeTravelOf } from '../stepSwipe.js';

const WIDTH = 390;
const MIDDLE = { hasPrevious: true, hasNext: true, width: WIDTH } as const;
const LEFT = { startX: 330, dx: -(STEP_SWIPE_MIN_TRAVEL_DP + 10), dy: 4 } as const;
const RIGHT = { startX: 60, dx: STEP_SWIPE_MIN_TRAVEL_DP + 10, dy: 4 } as const;

describe('stepSwipeOf', () => {
    it('reads a leftward swipe as the next step and a rightward one as the step before', () => {
        expect(stepSwipeOf({ ...MIDDLE, ...LEFT })).toBe('next');
        expect(stepSwipeOf({ ...MIDDLE, ...RIGHT })).toBe('back');
    });

    it('needs the full travel: one dp short is no move', () => {
        expect(stepSwipeOf({ ...MIDDLE, ...LEFT, dx: -STEP_SWIPE_MIN_TRAVEL_DP })).toBe('next');
        expect(stepSwipeOf({ ...MIDDLE, ...LEFT, dx: -(STEP_SWIPE_MIN_TRAVEL_DP - 1) })).toBeNull();
        expect(stepSwipeOf({ ...MIDDLE, ...RIGHT, dx: STEP_SWIPE_MIN_TRAVEL_DP - 1 })).toBeNull();
    });

    it('leaves a mostly vertical drag to the scroller', () => {
        expect(stepSwipeOf({ ...MIDDLE, ...LEFT, dy: Math.abs(LEFT.dx) })).toBeNull();
        expect(stepSwipeOf({ ...MIDDLE, ...RIGHT, dy: -RIGHT.dx })).toBeNull();
        expect(stepSwipeOf({ ...MIDDLE, ...LEFT, dy: Math.abs(LEFT.dx) - 1 })).toBe('next');
    });

    it('never moves back from step 1, so a stray swipe cannot exit cooking mode', () => {
        expect(stepSwipeOf({ ...MIDDLE, ...RIGHT, hasPrevious: false })).toBeNull();
        expect(stepSwipeOf({ ...MIDDLE, ...LEFT, hasPrevious: false })).toBe('next');
    });

    it('never moves on from the last step, so a stray swipe cannot finish the session', () => {
        expect(stepSwipeOf({ ...MIDDLE, ...LEFT, hasNext: false })).toBeNull();
        expect(stepSwipeOf({ ...MIDDLE, ...RIGHT, hasNext: false })).toBe('back');
    });

    it('ignores a gesture that starts in either edge zone', () => {
        expect(stepSwipeOf({ ...MIDDLE, ...RIGHT, startX: 4 })).toBeNull();
        expect(stepSwipeOf({ ...MIDDLE, ...RIGHT, startX: STEP_SWIPE_EDGE_DP - 1 })).toBeNull();
        expect(stepSwipeOf({ ...MIDDLE, ...RIGHT, startX: STEP_SWIPE_EDGE_DP })).toBe('back');
        expect(stepSwipeOf({ ...MIDDLE, ...LEFT, startX: WIDTH - 2 })).toBeNull();
        expect(stepSwipeOf({ ...MIDDLE, ...LEFT, startX: WIDTH - STEP_SWIPE_EDGE_DP })).toBeNull();
        expect(stepSwipeOf({ ...MIDDLE, ...LEFT, startX: WIDTH - STEP_SWIPE_EDGE_DP - 1 })).toBe('next');
    });
});

describe('swipeTravelOf', () => {
    const touch = (startPageX: number, currentPageX: number, currentTimeStamp: number) => ({
        touchActive: false,
        startPageX,
        startPageY: 100,
        currentPageX,
        currentPageY: 110,
        currentTimeStamp,
    });
    const eventWith = (touchBank: readonly unknown[]) => ({ touchHistory: { touchBank } });

    it('reads the start and the travel of the touch that moved last', () => {
        expect(swipeTravelOf(eventWith([touch(40, 10, 5), touch(300, 120, 9)]))).toEqual({
            startX: 300,
            dx: -180,
            dy: 10,
        });
    });

    it('skips the holes a touch bank keeps for released identifiers', () => {
        expect(swipeTravelOf(eventWith([undefined, touch(200, 260, 3)]))).toEqual({ startX: 200, dx: 60, dy: 10 });
    });

    it('answers nothing for an event with no readable touch', () => {
        expect(swipeTravelOf({})).toBeNull();
        expect(swipeTravelOf({ touchHistory: null })).toBeNull();
        expect(swipeTravelOf({ touchHistory: { touchBank: 'x' } })).toBeNull();
        expect(swipeTravelOf(eventWith([]))).toBeNull();
        expect(swipeTravelOf(eventWith([{ ...touch(1, 2, 3), startPageX: '1' }]))).toBeNull();
    });
});
