import { describe, expect, it } from 'vitest';

import { sessionClock, timerClock } from '../sessionClock.js';

import {
    HOUR,
    iso,
    makeCooking,
    makeEnded,
    makePage,
    makePaused,
    makeTimer,
    T0,
} from '../__fixtures__/keptFixtures.js';

const S = 1000;

describe('sessionClock (KTD6)', () => {
    const entry = makeCooking();
    const at = (ms: number) => iso(T0 + ms);

    it('resumes straight below 4 h, asks at 4 h, ends at 24 h (every boundary at or after)', () => {
        expect(sessionClock(entry, [], at(4 * HOUR - S))).toBe('resumeStraight');
        expect(sessionClock(entry, [], at(4 * HOUR))).toBe('askFirst');
        expect(sessionClock(entry, [], at(24 * HOUR - S))).toBe('askFirst');
        expect(sessionClock(entry, [], at(24 * HOUR))).toBe('ended');
    });

    it('AE3: 25 h with no timer is ended', () => {
        expect(sessionClock(entry, [], at(25 * HOUR))).toBe('ended');
    });

    it('counts a clock set back 1 h as no idle time', () => {
        expect(sessionClock(entry, [], at(-HOUR))).toBe('resumeStraight');
    });

    it('AE6: a 5 h running timer at 4 h 30 resumes straight (idle runs from its end)', () => {
        const running = makeTimer({ endsAt: at(5 * HOUR) });

        expect(sessionClock(entry, [running], at(4.5 * HOUR))).toBe('resumeStraight');
    });

    it.each(['ringing', 'endedAway'] as const)('qse 1: a %s timer idles from endedAt', (state) => {
        const timer = makeEnded(state, { endsAt: at(HOUR), endedAt: at(HOUR) });

        expect(sessionClock(entry, [timer], at(HOUR + 4 * HOUR - S))).toBe('resumeStraight');
        expect(sessionClock(entry, [timer], at(HOUR + 4 * HOUR))).toBe('askFirst');
        // AE7
        expect(sessionClock(entry, [timer], at(HOUR + 24 * HOUR - S))).toBe('askFirst');
        expect(sessionClock(entry, [timer], at(HOUR + 24 * HOUR))).toBe('ended');
    });

    it('a paused timer adds nothing (mutant: idle from the last touch only is the other direction)', () => {
        const paused = makePaused({ remainingMs: 10 * HOUR, pausedAt: at(0) });

        expect(sessionClock(entry, [paused], at(4 * HOUR))).toBe('askFirst');
    });

    it('a timer ending later than the last touch moves the anchor (mutant: last touch only)', () => {
        const timer = makeTimer({ endsAt: at(2 * HOUR) });

        expect(sessionClock(entry, [timer], at(5 * HOUR))).toBe('resumeStraight');
        expect(sessionClock(entry, [timer], at(6 * HOUR))).toBe('askFirst');
    });

    it.each([0, 1, 59 * 60 * S, 3 * HOUR, 4 * HOUR - 1])('resumes straight %i ms after the anchor', (ms) => {
        expect(sessionClock(entry, [], at(ms))).toBe('resumeStraight');
    });

    it('a page entry is only resumeStraight or ended, at 24 h after its last touch', () => {
        const page = makePage();

        expect(sessionClock(page, [], at(5 * HOUR))).toBe('resumeStraight');
        expect(sessionClock(page, [], at(24 * HOUR - S))).toBe('resumeStraight');
        expect(sessionClock(page, [], at(24 * HOUR))).toBe('ended');
    });
});

describe('timerClock (P19)', () => {
    const at = (ms: number) => iso(T0 + ms);
    const running = makeTimer({ endsAt: at(0) });

    it('keeps a timer whose recipe has a session', () => {
        expect(timerClock(running, true, at(100 * HOUR))).toBe('kept');
    });

    it('removes a session-less running timer 24 h after endsAt, at or after', () => {
        expect(timerClock(running, false, at(24 * HOUR - S))).toBe('kept');
        expect(timerClock(running, false, at(24 * HOUR))).toBe('removed');
    });

    it('counts a session-less ringing or endedAway timer from the later of endsAt and endedAt', () => {
        for (const state of ['ringing', 'endedAway'] as const) {
            const timer = makeEnded(state, { endsAt: at(0), endedAt: at(2 * HOUR) });

            expect(timerClock(timer, false, at(2 * HOUR + 24 * HOUR - S))).toBe('kept');
            expect(timerClock(timer, false, at(2 * HOUR + 24 * HOUR))).toBe('removed');
        }
    });

    it('counts a paused session-less timer from pausedAt, not endsAt', () => {
        const paused = makePaused({ remainingMs: HOUR, pausedAt: at(5 * HOUR) });

        expect(timerClock(paused, false, at(5 * HOUR + 24 * HOUR - S))).toBe('kept');
        expect(timerClock(paused, false, at(5 * HOUR + 24 * HOUR))).toBe('removed');
    });

    it('keeps a session-less running timer whose endsAt is ahead (resume cleared pausedAt)', () => {
        const resumed = makeTimer({ endsAt: at(30 * HOUR) });

        expect(timerClock(resumed, false, at(24 * HOUR))).toBe('kept');
    });
});
