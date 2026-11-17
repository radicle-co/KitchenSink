/**
 * The words that follow a number when the number is a time, and the unit each names.
 *
 * Reachable ONLY as `@kitchensink/recipe-core/time-unit-words`, never from the barrel:
 * `contract-gen` hashes the barrel, and a time-word list is no part of any wire shape, so exporting it there would move
 * `CONTRACT_HASH` for nothing. It is a module of its own, not part of `units.ts`, so the subpath publishes this list and
 * not the unit tables the barrel keeps back.
 */

/** The unit of a time. */
export type TimeUnit = 'hour' | 'minute' | 'second';

/**
 * Time words, lower case, each with the unit it names. A bare `m` or `s` is left out on purpose: "2 m of oil", "5 s" are
 * not time.
 */
export const TIME_UNIT_WORDS: Readonly<Record<string, TimeUnit>> = {
    h: 'hour',
    hr: 'hour',
    hrs: 'hour',
    hour: 'hour',
    hours: 'hour',
    min: 'minute',
    mins: 'minute',
    minute: 'minute',
    minutes: 'minute',
    sec: 'second',
    secs: 'second',
    second: 'second',
    seconds: 'second',
};

/** The unit of a time the duration reader does not read. */
export type LongTimeUnit = 'day' | 'week';

/**
 * Time words for days and weeks, for the step facts sheet ONLY. The duration reader, and so the cooking timer, does not
 * read them and must not: a timer of two days is not offered, and this list is not part of {@link TIME_UNIT_WORDS}.
 */
export const LONG_TIME_UNIT_WORDS: Readonly<Record<string, LongTimeUnit>> = {
    day: 'day',
    days: 'day',
    week: 'week',
    weeks: 'week',
};
