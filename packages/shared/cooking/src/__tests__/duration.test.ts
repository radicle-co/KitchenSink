/**
 * The duration reader and its two small helpers. The reader finds the timer a step line offers, so every row is a line
 * a cook could really read, with the exact seconds it must give. It reads English only.
 */
import { describe, expect, it } from 'vitest';

import { MIN_TIMER_MS } from '../timer.js';
import { durationParts, elapsedParts, offerSecondsOf, readDuration } from '../duration.js';

describe('readDuration', () => {
    it.each([
        ['Roast for 1 h 30', 5_400],
        ['Roast for 1 h 30 min', 5_400],
        ['Simmer 20 to 25 minutes', 1_200],
        ['Simmer 20-25 min', 1_200],
        ['Simmer 20–25 minutes', 1_200],
        ['Simmer for 20 or 25 minutes', 1_200],
        ['Rest for 1 hour 5 minutes', 3_900],
        ['Rest for 1 hour and 5 minutes', 3_900],
        ['Rest 1 hr, 5 mins', 3_900],
        ['Stir for 30 sec', 30],
        ['Stir for 30 seconds', 30],
        ['Stir for 1 second', 1],
        ['Bake 1½ hours', 5_400],
        ['Bake 1.5 hours', 5_400],
        ['Bake 1 ½ hours', 5_400],
        ['Bake ½ hour', 1_800],
        ['Bake for 2 hours', 7_200],
        ['A 10-minute rest', 600],
        ['Chill for 45 min.', 2_700],
        ['Chill for 45 MIN', 2_700],
        ['Bake 1/2 hour', 1_800],
        ['Bake 1/4 hour', 900],
        ['Bake 1 1/2 hours', 5_400],
        ['Bake 2 1/4 hours', 8_100],
        ['Bake between 20 and 25 minutes', 1_200],
        ['Bake 20‐25 minutes', 1_200],
        ['Bake 20‑25 minutes', 1_200],
        ['Bake 20‒25 minutes', 1_200],
        ['Bake 20―25 minutes', 1_200],
        ['Bake 20—25 minutes', 1_200],
        ['Boil 10 minutes 30', 600],
    ])('%s gives one duration of %i s', (line, seconds) => {
        expect(readDuration(line)).toEqual({ kind: 'one', seconds });
    });

    it.each(['bake 10 minutes then rest 5 minutes', 'Boil for 10 minutes, then simmer for 20 minutes'])(
        '%s gives many, so no offer is made',
        (line) => {
            expect(readDuration(line)).toEqual({ kind: 'many' });
        },
    );

    it.each([
        'Season to taste',
        '',
        'Heat the oven to 350 degrees',
        'Add 2 medium onions',
        'Cook until golden, about 2 m of oil',
        'Add 5 sprigs of thyme',
    ])('%j gives none', (line) => {
        expect(readDuration(line)).toEqual({ kind: 'none' });
    });

    it('does not read a bare number after an hour as minutes when it is something else', () => {
        expect(readDuration('Roast 1 hour 350 degrees')).toEqual({ kind: 'one', seconds: 3_600 });
        expect(readDuration('Roast 1 hour 30 degrees')).toEqual({ kind: 'one', seconds: 3_600 });
        expect(readDuration('Roast 1 hour 30%')).toEqual({ kind: 'one', seconds: 3_600 });
    });
});

describe('readDuration reads the number a cook wrote, or nothing', () => {
    it.each([
        ['Bake 1-1/2 hours', 5_400],
        ['Bake 1 and 1/2 hours', 5_400],
        ['Bake 2-1/2 hours', 9_000],
        ['Bake .5 hours', 1_800],
        ['Bake 1,5 hours', 5_400],
        ['Bake 1-2 hours', 3_600],
        ['Bake between 20 and 25 minutes', 1_200],
    ])('%s gives %i s', (line, seconds) => {
        expect(readDuration(line)).toEqual({ kind: 'one', seconds });
    });

    it.each(['Bake 1/0 hours', 'Bake 0 minutes', 'Bake 1 hour 1/0 minutes'])(
        '%s gives none, never a wrong number',
        (line) => {
            expect(readDuration(line)).toEqual({ kind: 'none' });
        },
    );

    it('never reads 1,000 minutes as 0', () => {
        const reading = readDuration('Simmer 1,000 minutes');

        expect(reading.kind === 'none' || (reading.kind === 'one' && reading.seconds > 0)).toBe(true);
    });

    it.each(['Add 2 minced onions', 'Make 1 hash', 'Check hourly', '5 secondary'])(
        '%s gives none: a unit word that is the start of a longer word is not time',
        (line) => {
            expect(readDuration(line)).toEqual({ kind: 'none' });
        },
    );

    it.each(['Bake 1 h 15 m', 'Bake 1h 15m', 'Bake 1 hour 30 s', 'Bake 10 minutes 5 s'])(
        '%s gives none: a bare m or s after the span is time it cannot read, so no wrong timer is offered',
        (line) => {
            expect(readDuration(line)).toEqual({ kind: 'none' });
        },
    );

    it.each([
        'Microwave 2 m 30 seconds',
        'Bake 2m, 30 seconds',
        'Bake 1 hour and 15 m',
        'Bake 1 hour, 15 m',
        'Bake 5 minutes and 5 s',
        'Bake 5 minutes, 5 s',
    ])('%s gives none: a bare m or s on either side of the span is time it cannot read', (line) => {
        expect(readDuration(line)).toEqual({ kind: 'none' });
    });

    it('does not over-reach: a unit like cm next to a span is not time', () => {
        expect(readDuration('Cut into 2 cm pieces, then bake 5 minutes')).toEqual({ kind: 'one', seconds: 300 });
    });

    it('reads two amounts of the same unit as many', () => {
        expect(readDuration('Rest 10 minutes, 5 minutes')).toEqual({ kind: 'many' });
    });
});

describe('readDuration finishes fast on hostile text (public recipes run on other cooks devices)', () => {
    const BUDGET_MS = 50;

    const timed = (line: string) => {
        const started = performance.now();
        const reading = readDuration(line);

        return { reading, ms: performance.now() - started };
    };

    it.each([
        ['1 x 100,000', '1'.repeat(100_000)],
        ['1, 100,000 spaces, x', `1${' '.repeat(100_000)}x`],
        ['1 - then 100,000 spaces', `1 -${' '.repeat(100_000)}`],
        ['1 to then 100,000 spaces', `1 to${' '.repeat(100_000)}`],
        ['1 and then 100,000 spaces', `1 and${' '.repeat(100_000)}`],
        ['20,000 digits', '1'.repeat(20_000)],
    ])('%s is read in under 50 ms', (_name, line) => {
        const { ms } = timed(line);

        expect(ms).toBeLessThan(BUDGET_MS);
    });

    it('gives none for a line over 2,000 characters, even one that holds 10 minutes', () => {
        const line = `${'x'.repeat(2_000)} 10 minutes`;

        expect(line.length).toBeGreaterThan(2_000);
        expect(readDuration(line)).toEqual({ kind: 'none' });
        expect(readDuration(`${'x'.repeat(1_900)} 10 minutes`)).toEqual({ kind: 'one', seconds: 600 });
    });
});

describe('offerSecondsOf', () => {
    it('a stored timer beats the line: 600 s over a line that reads 1,200', () => {
        expect(offerSecondsOf({ storedSeconds: 600, line: 'Simmer 20 minutes' })).toBe(600);
    });

    it('a stored timer wins even when the line reads many', () => {
        expect(offerSecondsOf({ storedSeconds: 600, line: 'bake 10 minutes then rest 5 minutes' })).toBe(600);
    });

    it('falls to the line when the stored timer is not a length a timer can have', () => {
        expect(offerSecondsOf({ storedSeconds: 3, line: 'Simmer 20 minutes' })).toBe(1_200);
        expect(offerSecondsOf({ storedSeconds: 5.0004, line: 'Simmer 20 minutes' })).toBe(1_200);
        expect(offerSecondsOf({ storedSeconds: 90_000, line: 'Simmer 20 minutes' })).toBe(1_200);
        expect(offerSecondsOf({ storedSeconds: 3, line: 'Season to taste' })).toBeUndefined();
    });

    it('falls to the line when nothing is stored, and to nothing when the line is unclear', () => {
        expect(offerSecondsOf({ line: 'Roast for 1 h 30' })).toBe(5_400);
        expect(offerSecondsOf({ line: 'bake 10 minutes then rest 5 minutes' })).toBeUndefined();
        expect(offerSecondsOf({ line: 'Season to taste' })).toBeUndefined();
    });

    it('offers nothing a timer cannot be: under 5 seconds or over 24 hours', () => {
        expect(offerSecondsOf({ line: 'Stir for 4 seconds' })).toBeUndefined();
        expect(offerSecondsOf({ line: 'Stir for 5 seconds' })).toBe(MIN_TIMER_MS / 1_000);
        expect(offerSecondsOf({ line: 'Wait 24 hours' })).toBe(86_400);
        expect(offerSecondsOf({ line: 'Wait 25 hours' })).toBeUndefined();
        expect(offerSecondsOf({ storedSeconds: 3, line: '' })).toBeUndefined();
        expect(offerSecondsOf({ storedSeconds: 5.0004, line: '' })).toBeUndefined();
    });
});

describe('durationParts', () => {
    it.each([
        [5_400, { hours: 1, minutes: 30, seconds: 0 }],
        [30, { hours: 0, minutes: 0, seconds: 30 }],
        [270, { hours: 0, minutes: 4, seconds: 30 }],
        [3_661, { hours: 1, minutes: 1, seconds: 1 }],
        [86_400, { hours: 24, minutes: 0, seconds: 0 }],
    ])('%i s', (seconds, parts) => {
        expect(durationParts(seconds)).toEqual(parts);
    });
});

describe('elapsedParts: whole minutes since the end, floored and never rounded', () => {
    it.each([
        [0, { kind: 'justNow' }],
        [40_000, { kind: 'justNow' }],
        [59_000, { kind: 'justNow' }],
        [59_999, { kind: 'justNow' }],
        [60_000, { kind: 'minutes', minutes: 1 }],
        [110_000, { kind: 'minutes', minutes: 1 }],
        [3_599_000, { kind: 'minutes', minutes: 59 }],
        [3_600_000, { kind: 'hours', hours: 1, minutes: 0 }],
        [3_900_000, { kind: 'hours', hours: 1, minutes: 5 }],
        [7_200_000, { kind: 'hours', hours: 2, minutes: 0 }],
        [-5_000, { kind: 'justNow' }],
    ])('%i ms', (elapsedMs, expected) => {
        expect(elapsedParts(elapsedMs)).toEqual(expected);
    });
});
