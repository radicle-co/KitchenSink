/**
 * The waits of one step: the one reading every duration goes through, beside the timer offer. A stored timer counts
 * once and wins over the text, each `one` line is a wait, a `many` line leaves the step unread, a time over 24 hours
 * is a wait that offers no timer, and a time under the shortest timer is no wait at all.
 */
import { describe, expect, it } from 'vitest';

import { stepWaitsOf } from '../duration.js';

describe('stepWaitsOf, the stored timer', () => {
    it('counts a stored timer once, whatever the lines say (a stored 25 min over three sentences)', () => {
        expect(
            stepWaitsOf({
                storedSeconds: 1_500,
                lines: ['Heat the pan.', 'Bake 10 minutes.', 'Rest 5 minutes.'],
            }),
        ).toEqual({ kind: 'stored', seconds: 1_500 });
    });

    it.each([2, 86_401, 0, -5, 1.5])(
        'falls to the lines when the stored %s s is not a length a timer can have',
        (storedSeconds) => {
            expect(stepWaitsOf({ storedSeconds, lines: ['Roast for 1 h 30.'] })).toEqual({
                kind: 'lines',
                waits: [{ seconds: 5_400, offers: true }],
                unread: false,
            });
        },
    );

    it('keeps a stored timer at the 24 hour bound, which is inclusive', () => {
        expect(stepWaitsOf({ storedSeconds: 86_400, lines: [] })).toEqual({ kind: 'stored', seconds: 86_400 });
    });
});

describe('stepWaitsOf, the lines', () => {
    it('reads one wait from one line', () => {
        expect(stepWaitsOf({ lines: ['Roast for 1 h 30.'] })).toEqual({
            kind: 'lines',
            waits: [{ seconds: 5_400, offers: true }],
            unread: false,
        });
    });

    it('reads two waits in the order of the lines', () => {
        expect(stepWaitsOf({ lines: ['Roast for 1 h 30.', 'Then rest for 20 min.'] })).toEqual({
            kind: 'lines',
            waits: [
                { seconds: 5_400, offers: true },
                { seconds: 1_200, offers: true },
            ],
            unread: false,
        });
    });

    it('keeps the high end of a range, and its low end is the wait', () => {
        expect(stepWaitsOf({ lines: ['Bake for 20-25 minutes.'] })).toEqual({
            kind: 'lines',
            waits: [{ seconds: 1_200, highSeconds: 1_500, offers: true }],
            unread: false,
        });
    });

    it('reads no wait from a step with no time, or with no lines', () => {
        expect(stepWaitsOf({ lines: ['Season to taste.'] })).toEqual({ kind: 'lines', waits: [], unread: false });
        expect(stepWaitsOf({ lines: [] })).toEqual({ kind: 'lines', waits: [], unread: false });
    });

    it('sets unread for a line with two times, and counts it as no wait (mutant: the first time is read)', () => {
        expect(stepWaitsOf({ lines: ['Bake 10 minutes, then rest 5 minutes.'] })).toEqual({
            kind: 'lines',
            waits: [],
            unread: true,
        });
    });

    it('keeps the wait of a one line beside an unread line of the same step', () => {
        expect(stepWaitsOf({ lines: ['Rest for 20 min.', 'Bake 10 minutes, then rest 5 minutes.'] })).toEqual({
            kind: 'lines',
            waits: [{ seconds: 1_200, offers: true }],
            unread: true,
        });
    });
});

describe('stepWaitsOf, times outside the timer bounds', () => {
    it('counts a time over 24 hours as a wait that offers no timer', () => {
        expect(stepWaitsOf({ lines: ['Marinate for 48 hours.'] })).toEqual({
            kind: 'lines',
            waits: [{ seconds: 172_800, offers: false }],
            unread: false,
        });
    });

    it('offers an exact 24 hours, and not a minute more', () => {
        expect(stepWaitsOf({ lines: ['Rest for 24 hours.'] })).toEqual({
            kind: 'lines',
            waits: [{ seconds: 86_400, offers: true }],
            unread: false,
        });
        expect(stepWaitsOf({ lines: ['Rest for 24 hours 1 minute.'] })).toEqual({
            kind: 'lines',
            waits: [{ seconds: 86_460, offers: false }],
            unread: false,
        });
    });

    it('counts a time under 5 seconds as no wait, and never as unread', () => {
        expect(stepWaitsOf({ lines: ['Whisk 2 seconds.'] })).toEqual({ kind: 'lines', waits: [], unread: false });
    });

    it('offers exactly 5 seconds, the shortest timer', () => {
        expect(stepWaitsOf({ lines: ['Whisk 5 seconds.'] })).toEqual({
            kind: 'lines',
            waits: [{ seconds: 5, offers: true }],
            unread: false,
        });
    });
});
