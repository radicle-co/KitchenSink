/**
 * Unit tests for the time-of-day greeting bucket (Home chrome, US-000).
 *
 * Requirement map:
 *  - FR-046 / Home chrome — the greeting is time-of-day aware ("Good afternoon, Chef!" in the mockup),
 *    so the host needs a PURE bucket function it can test at every boundary without freezing a clock.
 */
import { describe, expect, it } from 'vitest';

import { greetingBucketForHour, GREETING_BUCKETS, type GreetingBucket } from '../utils/timeOfDay.js';

describe('greetingBucketForHour', () => {
    describe('bucket boundaries', () => {
        // Exhaustive over every hour of the day: the mutation lens — an off-by-one in any boundary
        // (>= vs >, 12 vs 11) must fail at least one of these.
        const cases: readonly (readonly [number, GreetingBucket])[] = [
            [0, 'night'],
            [1, 'night'],
            [2, 'night'],
            [3, 'night'],
            [4, 'night'],
            [5, 'morning'],
            [6, 'morning'],
            [7, 'morning'],
            [8, 'morning'],
            [9, 'morning'],
            [10, 'morning'],
            [11, 'morning'],
            [12, 'afternoon'],
            [13, 'afternoon'],
            [14, 'afternoon'],
            [15, 'afternoon'],
            [16, 'afternoon'],
            [17, 'evening'],
            [18, 'evening'],
            [19, 'evening'],
            [20, 'evening'],
            [21, 'evening'],
            [22, 'night'],
            [23, 'night'],
        ];

        it.each(cases)('maps hour %i to the %s bucket', (hour, expected) => {
            expect(greetingBucketForHour(hour)).toBe(expected);
        });
    });

    describe('out-of-range hours (fail safe, never throw on a clock surprise)', () => {
        it('clamps a negative hour to the night bucket', () => {
            expect(greetingBucketForHour(-1)).toBe('night');
        });

        it('clamps an hour past the end of the day to the night bucket', () => {
            expect(greetingBucketForHour(24)).toBe('night');
            expect(greetingBucketForHour(99)).toBe('night');
        });

        it('floors a fractional hour rather than falling through', () => {
            expect(greetingBucketForHour(11.99)).toBe('morning');
            expect(greetingBucketForHour(12.01)).toBe('afternoon');
        });

        it('treats a non-finite hour as night rather than throwing', () => {
            expect(greetingBucketForHour(Number.NaN)).toBe('night');
            expect(greetingBucketForHour(Number.POSITIVE_INFINITY)).toBe('night');
        });
    });

    describe('GREETING_BUCKETS', () => {
        it('lists every bucket the function can return, so dictionaries can be exhaustive', () => {
            const produced = new Set<GreetingBucket>();

            for (let hour = 0; hour < 24; hour += 1) {
                produced.add(greetingBucketForHour(hour));
            }

            expect(new Set(GREETING_BUCKETS)).toEqual(produced);
        });
    });
});
