import { MAX_TIMER_MS, MIN_TIMER_MS } from './timer.js';

/**
 * What a step's text says about time, and the small pieces the copy layer turns into words.
 *
 * The reader finds the ONE duration a step offers as a timer. It is a small domain extractor, not a library,
 * because a duration library adds up every unit in a string and cannot find exactly one span in prose or take the low
 * end of a range. It reads English only, like the step-line splitter (`STEP_LINE_ABBREVIATIONS`).
 *
 * shortcut: number words ("an hour", "half an hour", "two minutes") are not read and a step that only says them offers
 * no timer, upgrade when a real recipe needs them. A bare number after an hour unit reads as minutes ("1 h 30") only
 * at the end of the text or before punctuation, so "1 h 30 then flip" reads one hour.
 */

/** What a line says: no duration, exactly one (in seconds), or several. */
export type DurationReading =
    { readonly kind: 'none' } | { readonly kind: 'one'; readonly seconds: number } | { readonly kind: 'many' };

const FRACTIONS: Readonly<Record<string, number>> = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3 };

const SECONDS_PER_UNIT: Readonly<Record<string, number>> = { h: 3_600, m: 60, s: 1 };

/** A number: digits with an optional decimal and an optional fraction glyph, or a fraction glyph alone. */
const NUMBER = String.raw`(?:\d+(?:\.\d+)?\s?[½¼¾⅓⅔]?|[½¼¾⅓⅔])`;

/** Units, English. A bare `m` or `s` is left out on purpose: "2 m of oil", "5 s" are not time. */
const UNIT = String.raw`(?:hours?|hrs?|h|minutes?|mins?|seconds?|secs?)`;

/**
 * One amount: a number, an optional range to a second number (only the first is read), an optional hyphen, and a unit.
 * A trailing `(?![a-z])` stops a unit word being a prefix of a longer word ("hash", "minced").
 */
const amountSource = (capture: boolean): string => {
    const group = (inner: string): string => (capture ? `(${inner})` : `(?:${inner})`);

    return `${group(NUMBER)}(?:\\s*(?:-|–|—|to|or)\\s*${NUMBER})?\\s*-?\\s*${group(UNIT)}(?![a-z])`;
};

/** What may sit between two amounts of one duration: only space, a comma or "and". */
const JOINER = String.raw`(?:\s*,\s*|\s+and\s+|\s+)`;

/** A bare number straight after an hour amount, read as minutes: only at the end or before punctuation. */
const BARE_MINUTES = String.raw`(?:\s+(?<bare>\d{1,2})(?=\s*(?:$|[.,;:!?)])))`;

/** One whole span of time: amounts joined by space, comma or "and", then an optional bare minute part. */
const SPAN = new RegExp(`${amountSource(false)}(?:${JOINER}${amountSource(false)})*${BARE_MINUTES}?`, 'giu');

const AMOUNT = new RegExp(amountSource(true), 'giu');

/** The value of a number token: digits, a decimal, a fraction glyph, or digits and a fraction glyph. */
function numberOf(token: string): number {
    const glyph = [...token].find((char) => char in FRACTIONS);
    const whole = Number.parseFloat(token.replace(/[^\d.]/gu, ''));
    const base = Number.isNaN(whole) ? 0 : whole;

    return base + (glyph === undefined ? 0 : (FRACTIONS[glyph] ?? 0));
}

/** The seconds one amount token ("1½ hours", "20 to 25 min") stands for: the first number times its unit. */
function secondsOfAmount(amount: string): number {
    const [match] = [...amount.matchAll(AMOUNT)];
    const [, quantity = '', unit = ''] = match ?? [];

    return numberOf(quantity) * (SECONDS_PER_UNIT[unit.toLowerCase().charAt(0)] ?? 0);
}

/**
 * Read the one duration a line offers.
 *
 * @param line - A step line, as cooking mode shows it.
 * @returns `one` with the seconds when the line holds exactly one span of time (a range gives its low end, and
 *   "1 hour 5 minutes" is one span), `many` when it holds two or more, else `none`. Pure.
 */
export function readDuration(line: string): DurationReading {
    const spans = [...line.matchAll(SPAN)];

    if (spans.length === 0) {
        return { kind: 'none' };
    }

    if (spans.length > 1) {
        return { kind: 'many' };
    }

    const [span = ''] = spans[0] ?? [];
    const bareMinutes = spans[0]?.groups?.['bare'];
    const total =
        [...span.matchAll(AMOUNT)].reduce((sum, amount) => sum + secondsOfAmount(amount[0]), 0) +
        (bareMinutes === undefined ? 0 : Number.parseInt(bareMinutes, 10) * 60);

    return total > 0 ? { kind: 'one', seconds: Math.round(total) } : { kind: 'none' };
}

/** The input to {@link offerSecondsOf}. */
export interface OfferInput {
    /** The step's own stored timer, in seconds. It wins over the text. */
    readonly storedSeconds?: number | undefined;
    /** The line the cook is on. */
    readonly line: string;
}

/**
 * The timer a step offers, in seconds, or nothing.
 *
 * @param input - The stored timer and the line.
 * @returns The stored timer when it is a valid length, else the line's one duration, else `undefined`. A length a
 *   timer cannot have (under 5 s or over 24 h) offers nothing. Pure.
 */
export function offerSecondsOf(input: OfferInput): number | undefined {
    const reading = readDuration(input.line);
    const seconds = input.storedSeconds ?? (reading.kind === 'one' ? reading.seconds : undefined);
    const valid = seconds !== undefined && seconds * 1_000 >= MIN_TIMER_MS && seconds * 1_000 <= MAX_TIMER_MS;

    return valid ? seconds : undefined;
}

/** A length as the parts the copy layer says aloud and shows. */
export interface DurationParts {
    readonly hours: number;
    readonly minutes: number;
    readonly seconds: number;
}

/**
 * Split a length into hours, minutes and seconds.
 *
 * @param totalSeconds - A whole number of seconds.
 * @returns The three parts, each below its carry except hours. Pure.
 */
export function durationParts(totalSeconds: number): DurationParts {
    return {
        hours: Math.floor(totalSeconds / 3_600),
        minutes: Math.floor((totalSeconds % 3_600) / 60),
        seconds: totalSeconds % 60,
    };
}

/** How long ago the alarm rang, in the parts the alarm's "rang ago" line says: just now, whole minutes, or hours and minutes. */
export type ElapsedParts =
    | { readonly kind: 'justNow' }
    | { readonly kind: 'minutes'; readonly minutes: number }
    | { readonly kind: 'hours'; readonly hours: number; readonly minutes: number };

/**
 * The time since the end, floored to the whole minute and never rounded.
 *
 * @param elapsedMs - Ms since the end. A negative value (a clock that went back) reads as just now.
 * @returns Under 1 minute `justNow`, under 1 hour `minutes`, else `hours` with the minutes left over. Pure.
 */
export function elapsedParts(elapsedMs: number): ElapsedParts {
    const totalMinutes = Math.floor(Math.max(0, elapsedMs) / 60_000);

    if (totalMinutes < 1) {
        return { kind: 'justNow' };
    }

    if (totalMinutes < 60) {
        return { kind: 'minutes', minutes: totalMinutes };
    }

    return { kind: 'hours', hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 };
}
