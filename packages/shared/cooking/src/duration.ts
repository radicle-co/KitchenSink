/**
 * What a step's text says about time, and the parts a length splits into.
 *
 * The reader finds the ONE duration a step offers as a timer. It is a small domain extractor, not a library,
 * because a duration library adds up every unit in a string and cannot find exactly one span in prose or take the low
 * end of a range. It reads English only.
 *
 * shortcut: number words ("an hour", "half an hour", "two minutes") are not read and a step that only says them offers
 * no timer, upgrade when a real recipe needs them. A bare number after an hour unit reads as minutes ("1 h 30") only
 * at the end of the text or before punctuation, so "1 h 30 then flip" reads one hour.
 */

import { isValidTimerMs } from './timer.js';

/** What a line says: no duration, exactly one (in seconds), or several. */
export type DurationReading =
    { readonly kind: 'none' } | { readonly kind: 'one'; readonly seconds: number } | { readonly kind: 'many' };

const FRACTIONS: Readonly<Record<string, number>> = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3 };

const SECONDS_PER_UNIT: Readonly<Record<string, number>> = { h: 3_600, m: 60, s: 1 };

/** A number: a mixed number or fraction ("1 1/2", "1/2"), digits with an optional decimal and fraction glyph, or a glyph. */
const NUMBER = String.raw`(?:\d+\s+\d+/\d+|\d+/\d+|\d+(?:\.\d+)?\s?[½¼¾⅓⅔]?|[½¼¾⅓⅔])`;

/** Every dash a step line may use between two numbers. */
const DASH = '[-‐‑‒–—―]';

/** Units, English. A bare `m` or `s` is left out on purpose: "2 m of oil", "5 s" are not time. */
const UNIT = String.raw`(?:hours?|hrs?|h|minutes?|mins?|seconds?|secs?)`;

/**
 * One amount: a number, an optional range to a second number (only the first is read), an optional hyphen, and a unit.
 * A trailing `(?![a-z])` stops a unit word being a prefix of a longer word ("hash", "minced").
 */
const amountSource = (capture: boolean): string => {
    const group = (inner: string): string => (capture ? `(${inner})` : `(?:${inner})`);

    return `${group(NUMBER)}(?:\\s*(?:${DASH}|to|or)\\s*${NUMBER}|\\s+and\\s+${NUMBER})?\\s*-?\\s*${group(UNIT)}(?![a-z])`;
};

/** What may sit between two amounts of one duration: only space, a comma or "and". */
const JOINER = String.raw`(?:\s*,\s*|\s+and\s+|\s+)`;

/** A bare number straight after an hour amount, read as minutes: only at the end or before punctuation. */
const BARE_MINUTES = String.raw`(?:\s+(?<bare>\d{1,2})(?=\s*(?:$|[.,;:!?)])))`;

/** One whole span of time: amounts joined by space, comma or "and", then an optional bare minute part. */
const SPAN = new RegExp(`${amountSource(false)}(?:${JOINER}${amountSource(false)})*${BARE_MINUTES}?`, 'giu');

const AMOUNT = new RegExp(amountSource(true), 'giu');

/** The value of a number token: a fraction, a mixed number, digits, a decimal, a fraction glyph, or digits and a glyph. */
function numberOf(token: string): number {
    const fraction = /^(?:(\d+)\s+)?(\d+)\/(\d+)$/u.exec(token.trim());

    if (fraction !== null) {
        const [, whole = '0', numerator = '0', denominator = '1'] = fraction;

        return Number(whole) + Number(numerator) / Number(denominator);
    }

    const glyph = [...token].find((char) => char in FRACTIONS);
    const digits = Number.parseFloat(token.replace(/[^\d.]/gu, ''));

    return (Number.isNaN(digits) ? 0 : digits) + (glyph === undefined ? 0 : (FRACTIONS[glyph] ?? 0));
}

/** The seconds one unit stands for ('h', 'hours', 'Min' and so on), or 0 for one it does not know. */
const unitSeconds = (unit: string): number => SECONDS_PER_UNIT[unit.toLowerCase().charAt(0)] ?? 0;

/** The seconds an amount ("1½ hours", "20 to 25 min") stands for: its first number times its unit. */
function secondsOfAmount(quantity: string, unit: string): number {
    return numberOf(quantity) * unitSeconds(unit);
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
    const amounts = [...span.matchAll(AMOUNT)].map((amount) => ({
        seconds: secondsOfAmount(amount[1] ?? '', amount[2] ?? ''),
        rank: unitSeconds(amount[2] ?? ''),
    }));

    // One span reads as one duration only when its units strictly fall ("1 hour 5 minutes"), never "10 minutes, 5 minutes".
    if (amounts.some((amount, index) => index > 0 && amount.rank >= (amounts[index - 1]?.rank ?? 0))) {
        return { kind: 'many' };
    }

    const bareMinutes = amounts.at(-1)?.rank === SECONDS_PER_UNIT['h'] ? spans[0]?.groups?.['bare'] : undefined;
    const total =
        amounts.reduce((sum, amount) => sum + amount.seconds, 0) +
        (bareMinutes === undefined ? 0 : Number.parseInt(bareMinutes, 10) * 60);

    return total > 0 ? { kind: 'one', seconds: Math.round(total) } : { kind: 'none' };
}

/** The one duration a line reads, in seconds, or `undefined` when it reads none or several. */
function secondsOfLine(line: string): number | undefined {
    const reading = readDuration(line);

    return reading.kind === 'one' ? reading.seconds : undefined;
}

/** The seconds when a timer can have that length, else `undefined`. */
function validSeconds(seconds: number | undefined): number | undefined {
    return seconds !== undefined && isValidTimerMs(seconds * 1_000) ? seconds : undefined;
}

/** The input to {@link offerSecondsOf}. */
export interface OfferInput {
    /** The step's own stored timer, in seconds. It wins over the text when it is a length a timer can have. */
    readonly storedSeconds?: number | undefined;
    /** The line the cook is on. */
    readonly line: string;
}

/**
 * The timer a step offers, in seconds, or nothing.
 *
 * @param input - The stored timer and the line.
 * @returns The stored timer when it is a valid length, else the line's one duration when that is valid, else `undefined`. A length a
 *   timer cannot have (below the shortest or above the longest timer) offers nothing. Pure.
 */
export function offerSecondsOf(input: OfferInput): number | undefined {
    return validSeconds(input.storedSeconds) ?? validSeconds(secondsOfLine(input.line));
}

/** A length split into hours, minutes and seconds. */
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

/** How long ago a timer ended: just now, whole minutes, or hours and minutes. */
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
