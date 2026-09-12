/**
 * Reading a `Retry-After` field (RFC 9110 §10.2.3): `delay-seconds` or an `HTTP-date`, and an HTTP-date in any of
 * its three forms (§5.6.7: "A recipient that parses a timestamp value in an HTTP field MUST accept all three
 * HTTP-date formats"). Anything else is no statement at all, so the block rule falls back to the declared duration
 * (ADR-0053 §5).
 */
import { describe, expect, it } from 'vitest';

import { retryAfterSeconds } from '../retryAfter.js';

/** 2015-10-21 07:27:00 UTC, one minute before every date the cases below state. */
const NOW = Date.UTC(2015, 9, 21, 7, 27, 0);

describe('retryAfterSeconds', () => {
    describe('delay-seconds', () => {
        it.each([
            ['120', 120],
            ['0', 0],
            ['  120\t', 120],
            ['007', 7],
        ])('reads %j as %i seconds', (value, seconds) => {
            expect(retryAfterSeconds(value, NOW)).toBe(seconds);
        });

        it('reads a number too large to be a real delay as at least that large, for the block rule to cap', () => {
            expect(retryAfterSeconds('9'.repeat(400), NOW)).toBeGreaterThan(Number.MAX_SAFE_INTEGER);
        });
    });

    describe('HTTP-date', () => {
        it.each([
            ['IMF-fixdate', 'Wed, 21 Oct 2015 07:28:00 GMT'],
            ['the obsolete RFC 850 form', 'Wednesday, 21-Oct-15 07:28:00 GMT'],
            ['the obsolete asctime form', 'Wed Oct 21 07:28:00 2015'],
        ])('reads %s as the seconds from now until it', (_, value) => {
            expect(retryAfterSeconds(value, NOW)).toBe(60);
        });

        it("reads asctime's space-padded day", () => {
            expect(retryAfterSeconds('Thu Oct  1 07:27:00 2015', Date.UTC(2015, 9, 1, 7, 26, 0))).toBe(60);
        });

        it('rounds a part of a second up, so a block never ends before the stated time', () => {
            expect(retryAfterSeconds('Wed, 21 Oct 2015 07:28:00 GMT', NOW + 59_500)).toBe(1);
        });

        it('reads a date already past as a negative number of seconds', () => {
            expect(retryAfterSeconds('Wed, 21 Oct 2015 07:26:00 GMT', NOW)).toBe(-60);
        });

        it('accepts a leap second', () => {
            expect(retryAfterSeconds('Thu, 31 Dec 2015 23:59:60 GMT', Date.UTC(2015, 11, 31, 23, 59, 0))).toBe(60);
        });

        it.each([
            ['a two-digit year more than 50 years ahead as the past century', 'Monday, 21-Oct-77 07:28:00 GMT', 1977],
            ['a two-digit year exactly 50 years ahead as this century', 'Monday, 21-Oct-76 07:28:00 GMT', 2076],
            ['a two-digit year a few years ahead as this century', 'Monday, 21-Oct-30 07:28:00 GMT', 2030],
        ])('reads %s (RFC 9110 §5.6.7)', (_, value, year) => {
            const now = Date.UTC(2026, 9, 1);

            expect(retryAfterSeconds(value, now)).toBe((Date.UTC(year, 9, 21, 7, 28, 0) - now) / 1000);
        });
    });

    describe('no statement', () => {
        it.each([
            ['an absent field', null],
            ['an empty field', ''],
            ['a negative delay', '-1'],
            ['a fractional delay', '1.5'],
            ['an exponent', '1e3'],
            ['a unit suffix', '120s'],
            ['a lower-case day name (the grammar is case-sensitive)', 'wed, 21 Oct 2015 07:28:00 GMT'],
            ['a zone other than GMT', 'Wed, 21 Oct 2015 07:28:00 UTC'],
            ['a day the month does not have', 'Sat, 31 Feb 2015 07:28:00 GMT'],
            ['hour 24', 'Wed, 21 Oct 2015 24:00:00 GMT'],
            ['minute 60', 'Wed, 21 Oct 2015 07:60:00 GMT'],
            ['second 61', 'Wed, 21 Oct 2015 07:28:61 GMT'],
            ['a one-digit day in IMF-fixdate', 'Wed, 1 Oct 2015 07:28:00 GMT'],
            ['an ISO 8601 timestamp', '2015-10-21T07:28:00Z'],
            ['trailing text', 'Wed, 21 Oct 2015 07:28:00 GMT; retry'],
            ['a date with no zone', 'Wed, 21 Oct 2015 07:28:00'],
        ])('refuses %s', (_, value) => {
            expect(retryAfterSeconds(value, NOW)).toBeUndefined();
        });
    });
});
