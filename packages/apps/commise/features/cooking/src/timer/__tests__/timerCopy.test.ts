/**
 * The timer copy (S3a.U3 C2): the label, the shown and spoken durations, the rang-ago line and the alarm fallbacks.
 * Every expected string is read from the catalogue and filled by the house helpers, so a reworded key moves the test
 * with it. The only literal strings are the two the catalogue must hold exactly: the no-break space and the mutation.
 */
import { fillTemplate, pluralOf, resolveMessages } from '@commise/i18n';
import { describe, expect, it } from 'vitest';

import { cookingMessages } from '../../messages.js';
import {
    alarmBodyFallback,
    alarmHeadlineFallback,
    countdownFigure,
    rangLine,
    shownDuration,
    spokenDuration,
    timerLabel,
} from '../timerCopy.js';

const en = resolveMessages(cookingMessages, 'en');
const NBSP = ' ';
const MIN = 60_000;
const HOUR = 60 * MIN;

// Designer (ordinal ruling, 2026-11-20): the ordinal goes with the step ("Simmer · step 2 (2)"), and S3a holds one timer, so
// the label never carries it. S6 adds the key on the step side with its first reader.
// A typed name wins; else a timer a step line OFFERED reads that line's label, by the index it stored (P63: not the
// first label of the step); else "Step {n}". The origin is the signal, never the duration or the absence of a typed
// name, so the name survives "+ time" and a reload.
describe('timerLabel', () => {
    const step = { number: 3, lines: ['Preheat the oven.', 'Roast for 1 hour 30 minutes.'] } as const;
    const twoTimed = { number: 3, lines: ['Roast 20 minutes.', 'Rest 10 minutes.'] } as const;
    const stepN = fillTemplate(en.timer.stepLabel, { n: 3 });
    const typed = { kind: 'typed', text: 'Rice' } as const;
    const offer = (lineIndex: number | null) => ({ kind: 'offer', lineIndex }) as const;

    it('says typed text as typed, whatever the origin', () => {
        expect(timerLabel({ label: typed, origin: offer(null) }, step, en.timer)).toBe('Rice');
        expect(timerLabel({ label: typed, origin: offer(1) }, step, en.timer)).toBe('Rice');
        expect(timerLabel({ label: typed, origin: { kind: 'added' } }, step, en.timer)).toBe('Rice');
    });

    it('an offered timer reads the label of the line that offered it', () => {
        expect(timerLabel({ label: undefined, origin: offer(1) }, step, en.timer)).toBe('Roast');
    });

    // Oracle row 1: it still reads "Roast" after "+ 10 min": the length changed, the origin did not.
    it('an offered timer keeps the line label when its length changed (+ 10 min)', () => {
        const lengthened = { label: undefined, origin: offer(1), durationMs: 100 * MIN } as const;

        // A timer, not a literal: the label reads no length, which `Pick` keeps out of the signature.
        expect(timerLabel(lengthened, step, en.timer)).toBe('Roast');
    });

    // Oracle row 2: an unnamed timer the cook added reads "Step 3", even at the length the step offered.
    it('an added unnamed timer reads "Step n", even at the length of the offer', () => {
        const offerLength = { label: undefined, origin: { kind: 'added' }, durationMs: 90 * MIN } as const;
        const shorter = { label: undefined, origin: { kind: 'added' }, durationMs: 5 * MIN } as const;

        expect(timerLabel(offerLength, step, en.timer)).toBe(stepN);
        expect(timerLabel(shorter, step, en.timer)).toBe(stepN);
    });

    // Oracle row 3: a step with two timed lines. Each offer reads its own line, so "Rest" never rings as "Roast".
    it('on a step with two timed lines, each offer reads its own line', () => {
        expect(timerLabel({ label: undefined, origin: offer(0) }, twoTimed, en.timer)).toBe('Roast');
        expect(timerLabel({ label: undefined, origin: offer(1) }, twoTimed, en.timer)).toBe('Rest');
    });

    // Oracle row 4: after the step's text was edited the line is not known, so the timer reads "Step 3" and does not
    // fall back to the first label of the step.
    it('an offer whose line is not known reads "Step n", not the first label of the step', () => {
        expect(timerLabel({ label: undefined, origin: offer(null) }, twoTimed, en.timer)).toBe(stepN);
    });

    it('an offer whose index is out of range reads "Step n"', () => {
        expect(timerLabel({ label: undefined, origin: offer(2) }, twoTimed, en.timer)).toBe(stepN);
        expect(timerLabel({ label: undefined, origin: offer(0) }, { number: 3, lines: [] }, en.timer)).toBe(stepN);
    });

    it('an offered timer whose line gives no label reads "Step n"', () => {
        expect(timerLabel({ label: undefined, origin: offer(0) }, { number: 3, lines: ['Stir.'] }, en.timer)).toBe(
            stepN,
        );
        expect(timerLabel({ label: undefined, origin: offer(0) }, { number: 3, lines: ['5 minutes.'] }, en.timer)).toBe(
            stepN,
        );
    });

    it('holds no ordinal key', () => {
        expect(Object.keys(en.timer)).toEqual(['stepLabel']);
    });
});

describe('shownDuration', () => {
    it.each([
        [90 * MIN, fillTemplate(en.duration.hoursMinutes, { h: 1, m: 30 })],
        [2 * HOUR, fillTemplate(en.duration.hoursOnly, { h: 2 })],
        [25 * MIN, fillTemplate(en.duration.minutesOnly, { m: 25 })],
        [30_000, fillTemplate(en.duration.secondsOnly, { s: 30 })],
    ])('shows %d ms as %s', (ms, text) => {
        expect(shownDuration(ms, en.duration)).toBe(text);
    });

    // D81 (designer): when seconds show, each shape is its own key and minutes always carry "min".
    it('uses one key for each shape that carries seconds', () => {
        expect(shownDuration(MIN + 30_000, en.duration)).toBe(
            fillTemplate(en.duration.minutesSeconds, { m: 1, s: 30 }),
        );
        expect(shownDuration(HOUR + 5_000, en.duration)).toBe(fillTemplate(en.duration.hoursSeconds, { h: 1, s: 5 }));
        expect(shownDuration(HOUR + 30 * MIN + 15_000, en.duration)).toBe(
            fillTemplate(en.duration.hoursMinutesSeconds, { h: 1, m: 30, s: 15 }),
        );
    });

    it("says the designer's three shapes with their units", () => {
        expect(en.duration.minutesSeconds).toBe('{m} min {s} sec');
        expect(en.duration.hoursSeconds).toBe('{h} h {s} sec');
        expect(en.duration.hoursMinutesSeconds).toBe('{h} h {m} min {s} sec');
    });

    it('shows nothing as zero seconds', () => {
        expect(shownDuration(0, en.duration)).toBe(fillTemplate(en.duration.secondsOnly, { s: 0 }));
    });
});

describe('a length is cut to whole seconds and never below zero', () => {
    it('floors 59.999 s to 59 s, shown and spoken', () => {
        expect(shownDuration(59_999, en.duration)).toBe(fillTemplate(en.duration.secondsOnly, { s: 59 }));
        expect(spokenDuration(59_999, en.duration, 'en')).toBe(pluralOf(en.duration.seconds, 59, 'en'));
    });

    it('reads a negative length as zero, shown and spoken', () => {
        expect(shownDuration(-5_000, en.duration)).toBe(fillTemplate(en.duration.secondsOnly, { s: 0 }));
        expect(spokenDuration(-5_000, en.duration, 'en')).toBe(pluralOf(en.duration.seconds, 0, 'en'));
    });

    it('says zero seconds in words for zero', () => {
        expect(spokenDuration(0, en.duration, 'en')).toBe(pluralOf(en.duration.seconds, 0, 'en'));
    });
});

describe('spokenDuration', () => {
    it('says words, drops zero parts and joins with a space', () => {
        expect(spokenDuration(HOUR + 5 * MIN, en.duration, 'en')).toBe(
            `${pluralOf(en.duration.hours, 1, 'en')} ${pluralOf(en.duration.minutes, 5, 'en')}`,
        );
        expect(spokenDuration(2 * HOUR, en.duration, 'en')).toBe(pluralOf(en.duration.hours, 2, 'en'));
        expect(spokenDuration(30_000, en.duration, 'en')).toBe(pluralOf(en.duration.seconds, 30, 'en'));
        expect(spokenDuration(MIN, en.duration, 'en')).toBe(pluralOf(en.duration.minutes, 1, 'en'));
    });
});

describe('rangLine', () => {
    const label = 'Roast';
    const line = (elapsedMs: number) => rangLine(label, elapsedMs, en);

    it('says "just now" under a minute, in its own string', () => {
        expect(line(59_999)).toBe(fillTemplate(en.alarm.rangJustNow, { label }));
        expect(line(-5)).toBe(fillTemplate(en.alarm.rangJustNow, { label }));
    });

    it('says whole minutes from one minute, floored', () => {
        expect(line(MIN)).toBe(
            fillTemplate(en.alarm.rangAgo, { label, elapsed: fillTemplate(en.duration.minutesOnly, { m: 1 }) }),
        );
        expect(line(5 * MIN + 59_000)).toBe(
            fillTemplate(en.alarm.rangAgo, { label, elapsed: fillTemplate(en.duration.minutesOnly, { m: 5 }) }),
        );
    });

    it('says hours and minutes with "min" from one hour, and hours alone when the minutes are 0', () => {
        expect(line(HOUR + 5 * MIN)).toBe(
            fillTemplate(en.alarm.rangAgo, {
                label,
                elapsed: fillTemplate(en.duration.hoursMinutesAgo, { h: 1, m: 5 }),
            }),
        );
        expect(line(2 * HOUR)).toBe(
            fillTemplate(en.alarm.rangAgo, { label, elapsed: fillTemplate(en.duration.hoursOnly, { h: 2 }) }),
        );
    });
});

describe('the alarm fallbacks', () => {
    it('says "{duration} timer done" with the shown duration', () => {
        expect(alarmHeadlineFallback(90 * MIN, en)).toBe(
            fillTemplate(en.alarm.headlineFallback, { duration: shownDuration(90 * MIN, en.duration) }),
        );
    });

    it('says "Step n: line" for the body', () => {
        expect(alarmBodyFallback(4, 'Stir the pot.', en)).toBe(
            fillTemplate(en.alarm.bodyFallback, { n: 4, line: 'Stir the pot.' }),
        );
    });
});

describe('the catalogue joins "step {n}" with a no-break space (R21)', () => {
    /** Every string in the timer, duration, alarm and addTimer groups, with its path. */
    const leaves = (value: unknown, path: string): [string, string][] => {
        if (typeof value === 'string') {
            return [[path, value]];
        }

        return typeof value === 'object' && value !== null
            ? Object.entries(value).flatMap(([key, child]) => leaves(child, `${path}.${key}`))
            : [];
    };

    const all = [
        ...leaves(en.timer, 'timer'),
        ...leaves(en.alarm, 'alarm'),
        ...leaves(en.duration, 'duration'),
        ...leaves(en.addTimer, 'addTimer'),
    ];

    it.each(all.filter(([, text]) => /step\s*\{n\}/i.test(text)))('%s has a no-break space', (_path, text) => {
        expect(text).toMatch(new RegExp(`step${NBSP}\\{n\\}`, 'i'));
    });

    it('holds at least the two step messages the scan covers', () => {
        expect(all.filter(([, text]) => /step\s*\{n\}/i.test(text)).length).toBeGreaterThanOrEqual(2);
    });
});

describe('the six Add a timer keys', () => {
    it('are the three box labels and the three units', () => {
        expect(new Set(Object.keys(en.addTimer))).toEqual(
            new Set(['hoursLabel', 'hoursUnit', 'minutesLabel', 'minutesUnit', 'secondsLabel', 'secondsUnit']),
        );
    });
});

describe('countdownFigure: the time on the dock row', () => {
    it.each([
        [4 * MIN + 30_000, '4:30'],
        [HOUR + 9 * MIN + 50_000, '1:09:50'],
        [HOUR, '1:00:00'],
        [59_000, '0:59'],
        [10 * MIN, '10:00'],
        [0, '0:00'],
        [-5_000, '0:00'],
    ])('reads %i ms as %s', (ms, shown) => {
        expect(countdownFigure(ms)).toBe(shown);
    });

    it('rounds a part of a second up, so the figure never reads zero while time is left', () => {
        expect(countdownFigure(1)).toBe('0:01');
        expect(countdownFigure(4 * MIN + 29_001)).toBe('4:30');
        expect(countdownFigure(4 * MIN + 29_000)).toBe('4:29');
    });
});
