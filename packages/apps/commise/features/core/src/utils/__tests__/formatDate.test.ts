import { describe, expect, it } from 'vitest';

import { formatHomeDate } from '../formatDate.js';

/**
 * The Home greeting subtitle is a full, locale-formatted calendar date ("Saturday, May 31, 2026" in the
 * mockup). It is SHARED product knowledge — web and mobile must render the same date the same way (FR-044) —
 * so the format lives once in `@commise/features-core`, and these tests pin it against drift.
 */
describe('formatHomeDate', () => {
    // Noon LOCAL time on 2026-05-31 — which is a SUNDAY (the mockup's "Saturday" label was fictional design
    // copy; the real calendar wins). Local construction + local formatting means the calendar day cannot flip
    // with the runner's timezone, so the assertion pins the FORMAT, not the clock. The date formatter
    // deliberately uses the viewer's local zone (the greeting shows "today" where the viewer is).
    //
    // REWRITTEN for the Home header board (HomeAndroid384, "Sunday 25 October"): the year is dropped when the date is
    // in the current year, and kept when it is not. The old assertions that pinned "…, 2026" are replaced, not loosened.
    const sunday = new Date(2026, 4, 31, 12, 0, 0);

    it('drops the year when the date is in the current year', () => {
        expect(formatHomeDate(sunday, 'en-US', sunday)).toBe('Sunday, May 31');
    });

    it('follows the locale order: day before month in en-GB, as on the board', () => {
        expect(formatHomeDate(new Date(2026, 9, 25, 12), 'en-GB', new Date(2026, 9, 25, 12))).toBe('Sunday 25 October');
    });

    it('keeps the year for a date in a past year', () => {
        expect(formatHomeDate(sunday, 'en-US', new Date(2027, 0, 1, 12))).toBe('Sunday, May 31, 2026');
    });

    it('compares the calendar year, not the instant: the last day of last year keeps its year', () => {
        const newYearsEve = new Date(2026, 11, 31, 23, 59);

        expect(formatHomeDate(newYearsEve, 'en-US', new Date(2027, 0, 1, 0, 1))).toBe('Thursday, December 31, 2026');
    });

    it('includes the full weekday name — the subtitle leads with the day of week', () => {
        // A format that dropped the weekday would still contain the month/day; asserting the weekday
        // explicitly is what fails if someone swaps to a `dateStyle: 'long'` that omits it.
        expect(formatHomeDate(sunday, 'en-US', sunday)).toMatch(/^Sunday,/u);
    });

    it('localizes the month and weekday names for a non-English locale', () => {
        const formatted = formatHomeDate(sunday, 'es-ES', sunday);

        // Spanish: "domingo" + "mayo". Assert the Spanish names so an accidentally hard-coded English format
        // is caught rather than passing on a locale it never actually applied.
        expect(formatted.toLowerCase()).toContain('mayo');
        expect(formatted.toLowerCase()).toContain('domingo');
        expect(formatted).not.toContain('2026');
    });

    it('degrades to the runtime default locale on a malformed tag instead of throwing', () => {
        // A greeting subtitle must never be able to crash Home. `Intl` throws RangeError on a bad tag; the
        // formatter must swallow that and still return a non-empty date string.
        expect(() => formatHomeDate(sunday, 'not a real tag!!', sunday)).not.toThrow();
        expect(formatHomeDate(sunday, 'not a real tag!!', sunday)).not.toBe('');
    });
});
