/**
 * @module @commise/features-core — the locale-formatted Home greeting date (Home chrome).
 *
 * The Home greeting carries a subtitle with today's full calendar date ("Saturday, May 31, 2026" in the
 * mockup). Which date that is, and how it is written, is SHARED product knowledge: web and mobile must show
 * the same date in the same format (FR-044 parity), so it lives here once rather than being forked per app.
 *
 * Formatting is delegated to `Intl.DateTimeFormat` (library-first: never hand-roll date/time formatting).
 * Reading the clock is the CALLER's side effect — this module only maps a `Date` to a string, which is what
 * keeps it pure and testable without freezing time.
 */

/** The date-part options that produce the mockup's "Saturday, May 31, 2026" long form. */
const HOME_DATE_OPTIONS: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
};

/**
 * Format a date as the Home greeting subtitle: full weekday, month, day, and year, in the viewer's locale
 * and local timezone.
 *
 * Deliberately NOT pinned to a fixed timezone: the greeting shows "today" as the viewer experiences it, so
 * the date must be rendered in their local zone. A malformed `locale` degrades to the runtime default rather
 * than throwing — a decorative subtitle must never be able to break the Home header.
 *
 * @param date - The instant to render (the caller supplies `new Date()`).
 * @param locale - A BCP-47 language tag.
 * @returns The localized long-form date string. Pure.
 */
export function formatHomeDate(date: Date, locale: string): string {
    return createDateFormatter(locale).format(date);
}

/**
 * Build the date formatter, degrading to the runtime default locale on an unusable tag.
 *
 * @param locale - A BCP-47 language tag.
 * @returns A formatter emitting the long-form date in the local timezone.
 */
function createDateFormatter(locale: string): Intl.DateTimeFormat {
    try {
        return new Intl.DateTimeFormat(locale, HOME_DATE_OPTIONS);
    } catch {
        // `Intl` throws RangeError on a malformed tag. A bad locale must degrade to the default, not blank
        // the greeting subtitle.
        return new Intl.DateTimeFormat(undefined, HOME_DATE_OPTIONS);
    }
}
