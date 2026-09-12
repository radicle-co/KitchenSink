/**
 * Reading a `Retry-After` field (RFC 9110 §10.2.3): `delay-seconds`, or an `HTTP-date` in any of the three forms a
 * recipient MUST accept (§5.6.7). The parse is strict. `Date.parse` is not used, because it accepts forms no server
 * sends and reads a malformed field as some date rather than as none. A field this module cannot read is no
 * statement, and the block rule falls back to the source's declared duration (ADR-0053 §5).
 *
 * @pattern Parser — one total function from a field's text to the seconds it states, or to no statement
 * @module
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

const DAY_NAME = '(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)';
const DAY_NAME_LONG = '(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)';
const MONTH = `(?<month>${MONTHS.join('|')})`;
const TIME = '(?<hour>\\d{2}):(?<minute>\\d{2}):(?<second>\\d{2})';

/** `Sun, 06 Nov 1994 08:49:37 GMT`, the form every current server sends. */
const IMF_FIXDATE = new RegExp(`^${DAY_NAME}, (?<day>\\d{2}) ${MONTH} (?<year>\\d{4}) ${TIME} GMT$`, 'u');

/** `Sunday, 06-Nov-94 08:49:37 GMT`, obsolete, with a two-digit year. */
const RFC_850_DATE = new RegExp(`^${DAY_NAME_LONG}, (?<day>\\d{2})-${MONTH}-(?<year>\\d{2}) ${TIME} GMT$`, 'u');

/** `Sun Nov  6 08:49:37 1994`, obsolete, with a space-padded day. */
const ASCTIME_DATE = new RegExp(`^${DAY_NAME} ${MONTH} (?<day>\\d{2}| \\d) ${TIME} (?<year>\\d{4})$`, 'u');

/** `delay-seconds = 1*DIGIT`. No sign, no fraction, no exponent. */
const DELAY_SECONDS = /^\d+$/u;

/** The named groups each date pattern captures. */
interface DateParts {
    readonly day: string;
    readonly month: string;
    readonly hour: string;
    readonly minute: string;
    readonly second: string;
}

/**
 * The four-digit year of an RFC 850 date's two-digit year: this century's, unless that appears more than 50 years in
 * the future, when it is the most recent past year with the same last two digits (RFC 9110 §5.6.7). Pure.
 *
 * @param twoDigits - The year's last two digits.
 * @param now - The current time, epoch milliseconds.
 * @returns The four-digit year.
 */
function rfc850Year(twoDigits: number, now: number): number {
    const thisYear = new Date(now).getUTCFullYear();
    const year = thisYear - (thisYear % 100) + twoDigits;

    return year > thisYear + 50 ? year - 100 : year;
}

/**
 * The instant a date's parts name, or none when a part is out of range or the month has no such day. Pure.
 *
 * `setUTCFullYear` is used rather than `Date.UTC`, which reads a year below 100 as 1900 plus that year.
 *
 * @param parts - The captured parts.
 * @param year - The four-digit year.
 * @returns Epoch milliseconds, or `undefined`.
 */
function instantOf(parts: DateParts, year: number): number | undefined {
    const day = Number(parts.day.trim());
    const month = MONTHS.findIndex((name) => name === parts.month);
    const [hour, minute, second] = [Number(parts.hour), Number(parts.minute), Number(parts.second)];

    // RFC 9110's `second` runs to 60, for a leap second.
    if (hour > 23 || minute > 59 || second > 60) {
        return undefined;
    }

    const date = new Date(0);

    date.setUTCFullYear(year, month, day);

    // A day the month does not have rolls into the next month; such a date is refused, not moved.
    if (date.getUTCDate() !== day || date.getUTCMonth() !== month) {
        return undefined;
    }

    date.setUTCHours(hour, minute, second, 0);

    return date.getTime();
}

/**
 * The instant an HTTP-date names, in any of its three forms, or none. Pure.
 *
 * @param text - The field's text, trimmed.
 * @param now - The current time, epoch milliseconds, for an RFC 850 date's century.
 * @returns Epoch milliseconds, or `undefined` when the text is not an HTTP-date.
 */
function httpDateInstant(text: string, now: number): number | undefined {
    const fixdate = IMF_FIXDATE.exec(text)?.groups;

    if (fixdate !== undefined) {
        return instantOf(datePartsOf(fixdate), Number(fixdate['year']));
    }

    const rfc850 = RFC_850_DATE.exec(text)?.groups;

    if (rfc850 !== undefined) {
        return instantOf(datePartsOf(rfc850), rfc850Year(Number(rfc850['year']), now));
    }

    const asctime = ASCTIME_DATE.exec(text)?.groups;

    if (asctime !== undefined) {
        return instantOf(datePartsOf(asctime), Number(asctime['year']));
    }

    return undefined;
}

/**
 * Read a matched pattern's groups as date parts. Every pattern captures all five groups on a match, so the empty
 * fallback exists for the type only. Pure.
 *
 * @param groups - A successful match's groups.
 * @returns The parts.
 */
function datePartsOf(groups: Readonly<Record<string, string | undefined>>): DateParts {
    return {
        day: groups['day'] ?? '',
        month: groups['month'] ?? '',
        hour: groups['hour'] ?? '',
        minute: groups['minute'] ?? '',
        second: groups['second'] ?? '',
    };
}

/**
 * The seconds a `Retry-After` field asks a client to wait. Pure.
 *
 * @param value - The field's value, or `null` when the response did not carry it.
 * @param now - The current time, epoch milliseconds. An HTTP-date is read relative to it.
 * @returns The seconds, rounded up so a wait never ends before the stated time. A date already past gives zero or a
 *   negative number, and a delay too large to be real gives a number at least that large, so the caller decides how
 *   to bound both. `undefined` when the field is absent or is neither form.
 */
export function retryAfterSeconds(value: string | null, now: number): number | undefined {
    if (value === null) {
        return undefined;
    }

    // Optional whitespace around a field value is not part of it (RFC 9110 §5.5).
    const text = value.trim();

    if (DELAY_SECONDS.test(text)) {
        return Number(text);
    }

    const instant = httpDateInstant(text, now);

    return instant === undefined ? undefined : Math.ceil((instant - now) / 1000);
}
