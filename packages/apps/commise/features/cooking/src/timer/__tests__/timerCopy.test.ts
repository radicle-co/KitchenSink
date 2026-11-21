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
describe('timerLabel', () => {
    it('says typed text as typed', () => {
        expect(timerLabel({ label: { kind: 'typed', text: 'Rice' } }, 3, en.timer)).toBe('Rice');
    });

    it('says the line label as read', () => {
        expect(timerLabel({ label: { kind: 'line', text: 'Roast' } }, 3, en.timer)).toBe('Roast');
    });

    it('says "Step n" with no label', () => {
        expect(timerLabel({ label: undefined }, 3, en.timer)).toBe(fillTemplate(en.timer.stepLabel, { n: 3 }));
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
