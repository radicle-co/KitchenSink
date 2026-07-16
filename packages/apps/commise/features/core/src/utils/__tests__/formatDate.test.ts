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
    const sunday = new Date(2026, 4, 31, 12, 0, 0);

    it('formats a date as weekday, month, day, and year (the mockup long form)', () => {
        expect(formatHomeDate(sunday, 'en-US')).toBe('Sunday, May 31, 2026');
    });

    it('includes the full weekday name — the subtitle leads with the day of week', () => {
        // A format that dropped the weekday would still contain the month/day/year; asserting the weekday
        // explicitly is what fails if someone swaps to a `dateStyle: 'long'` that omits it.
        expect(formatHomeDate(sunday, 'en-US')).toMatch(/^Sunday,/u);
    });

    it('localizes the month and weekday names for a non-English locale', () => {
        const formatted = formatHomeDate(sunday, 'es-ES');

        // Spanish: "domingo" + "mayo". Assert the Spanish names so an accidentally hard-coded English format
        // is caught rather than passing on a locale it never actually applied.
        expect(formatted.toLowerCase()).toContain('mayo');
        expect(formatted.toLowerCase()).toContain('domingo');
    });

    it('degrades to the runtime default locale on a malformed tag instead of throwing', () => {
        // A greeting subtitle must never be able to crash Home. `Intl` throws RangeError on a bad tag; the
        // formatter must swallow that and still return a non-empty date string.
        expect(() => formatHomeDate(sunday, 'not a real tag!!')).not.toThrow();
        expect(formatHomeDate(sunday, 'not a real tag!!')).not.toBe('');
    });
});
