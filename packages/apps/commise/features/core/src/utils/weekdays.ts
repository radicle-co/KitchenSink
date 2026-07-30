/**
 * @module @commise/features-core — locale-aware weekday labels (Home chrome / meal-plan widget shape).
 *
 * The week's day names are REAL data — the meal-plan skeleton shows real weekdays with unknown meals, not
 * invented content — so they must be correct in every locale rather than a hard-coded English array.
 * Formatting is delegated to `Intl.DateTimeFormat` (library-first: never hand-roll date/time formatting).
 */

/**
 * 2024-01-01T00:00:00Z was a Monday. Used purely as an anchor to enumerate a week; formatting is pinned to
 * UTC so the label set cannot shift by one day depending on the runner's timezone.
 */
const MONDAY_ANCHOR_UTC_MS = Date.UTC(2024, 0, 1);

/** Milliseconds in a day. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** Days in a week. */
export const DAYS_PER_WEEK = 7;

/**
 * The seven short weekday labels, Monday-first, formatted for `locale`.
 *
 * Monday-first matches the mockup's meal-plan strip (MON → SUN). It is deliberately NOT derived from the
 * locale's own first-day-of-week: the mockup's layout is fixed, and this function's contract is "the labels
 * for the strip as designed". Revisit if the strip itself becomes locale-ordered.
 *
 * @param locale - A BCP-47 language tag.
 * @returns Seven short weekday names starting at Monday. Falls back to the runtime default locale if `locale`
 * is not a tag `Intl` accepts, rather than throwing — a label set must never break the Home render. Pure.
 */
export function weekdayLabels(locale: string): readonly string[] {
    const format = createWeekdayFormatter(locale);

    return Array.from({ length: DAYS_PER_WEEK }, (_unused, index) =>
        format.format(new Date(MONDAY_ANCHOR_UTC_MS + index * DAY_MS)),
    );
}

/**
 * Build the weekday formatter, degrading to the runtime default locale on an unusable tag.
 *
 * @param locale - A BCP-47 language tag.
 * @returns A formatter emitting a short weekday name in UTC.
 */
function createWeekdayFormatter(locale: string): Intl.DateTimeFormat {
    const options: Intl.DateTimeFormatOptions = { weekday: 'short', timeZone: 'UTC' };

    try {
        return new Intl.DateTimeFormat(locale, options);
    } catch {
        // `Intl` throws RangeError on a malformed tag. A bad locale must degrade to the default, not blank
        // the meal-plan strip.
        return new Intl.DateTimeFormat(undefined, options);
    }
}
