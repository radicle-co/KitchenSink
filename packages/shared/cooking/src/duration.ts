/**
 * What a step's text says about time, and the parts a length splits into.
 *
 * The reader finds the ONE duration a step offers as a timer. It is a small domain extractor, not a library,
 * because a duration library adds up every unit in a string and cannot find exactly one span in prose or take the low
 * end of a range. It reads English only.
 *
 * Times written in words ("an hour and a half", "ten to fifteen minutes") are read by `durationWords.ts`. That layer
 * runs only when this digit layer matched no span, so a line with a digit time is never read by it.
 *
 * shortcut: a bare number after an hour unit reads as minutes ("1 h 30") only at the end of the text or before
 * punctuation, so "1 h 30 then flip" reads one hour. Upgrade when a real recipe needs more.
 */

import { amountAt } from '@kitchensink/recipe-core/parsing/measure-reader';
import { SECONDS_PER_TIME_UNIT, TIME_UNIT_WORDS } from '@kitchensink/recipe-core/time-unit-words';

import { oneReading, type DurationReading } from './durationReading.js';
import { readWordDuration } from './durationWords.js';
import { isValidTimerMs } from './timer.js';

/**
 * The longest line the reader looks at. Step text of a public recipe runs on every reader's device and has no maximum
 * where it is written, so a longer line reads `none`. It is not cut: a cut "1 hour 30 minutes" would read 1 h 03.
 */
const MAX_READ_LINE_CHARS = 2_000;

/**
 * A number as a cook writes it: a mixed number or fraction ("1 1/2", "1-1/2", "1 and 1/2", "1/2"), digits with an
 * optional decimal point or comma and fraction glyph, a leading point (".5"), or a glyph. The value is read from it by
 * recipe-core's measure reader, which owns how an amount is written.
 */
const NUMBER = String.raw`(?:\d+(?:\s+(?:and\s+)?|-)\d+/\d+|\d+/\d+|\d+(?:[.,]\d+)?(?:\s?[½¼¾⅓⅔])?|[.,]\d+|[½¼¾⅓⅔])`;

/** Every dash a step line may use between two numbers. */
const DASH = '[-‐‑‒–—―]';

/** Units, English, from the one list of time words. */
const UNIT = `(?:${Object.keys(TIME_UNIT_WORDS).join('|')})`;

/**
 * One amount: a number, an optional range to a second number (the first is the low end, the second the high end), an
 * optional hyphen, and a unit.
 * A trailing `(?![a-z])` stops a unit word being a prefix of a longer word ("hash", "minced").
 */
const amountSource = (capture: boolean): string => {
    const group = (inner: string): string => (capture ? `(${inner})` : `(?:${inner})`);

    // No amount starts inside a run of digits, points or commas, and the whitespace before the unit has one reading.
    return `(?<![\\d.,])${group(NUMBER)}(?:(?:\\s*(?:${DASH}|to|or)\\s*|\\s+and\\s+)${group(NUMBER)})?\\s*(?:-\\s*)?${group(UNIT)}(?![a-z])`;
};

/** What may sit between two amounts of one duration: only space, a comma or "and". */
const JOINER = String.raw`(?:\s*,\s*|\s+and\s+|\s+)`;

/** A bare number straight after an hour amount, read as minutes: only at the end or before punctuation. */
const BARE_MINUTES = String.raw`(?:\s+(?<bare>\d{1,2})(?=\s*(?:$|[.,;:!?)])))`;

/**
 * A bare `m` or `s` amount next to the span, after it ("1 h 15 m") or before it ("2 m 30 seconds"): time the reader does
 * not read, so the span alone would give a wrong total. The line then reads `none`. Both are built from the same joiner
 * the span uses.
 */
const UNREAD_TIME_AFTER = new RegExp(String.raw`^${JOINER}\d+(?:[.,]\d+)?\s*[ms](?![a-z])`, 'iu');
const UNREAD_TIME_BEFORE = new RegExp(String.raw`(?<![\d.,])\d+(?:[.,]\d+)?\s*[ms]${JOINER}$`, 'iu');

/** One whole span of time: amounts joined by space, comma or "and", then an optional bare minute part. */
const SPAN = new RegExp(`${amountSource(false)}(?:${JOINER}${amountSource(false)})*${BARE_MINUTES}?`, 'giu');

const AMOUNT = new RegExp(amountSource(true), 'giu');

/** The value of a number token, or `undefined` when it is not a positive finite amount ("1/0"). */
function numberOf(token: string): number | undefined {
    const words = token
        .trim()
        .split(/\s+/u)
        .filter((word) => word.toLowerCase() !== 'and');

    return amountAt(words, 0)?.low;
}

/** The seconds one unit stands for ('h', 'hours', 'Min' and so on), or 0 for one it does not know. */
const unitSeconds = (unit: string): number => SECONDS_PER_TIME_UNIT[TIME_UNIT_WORDS[unit.toLowerCase()]] ?? 0;

/** The seconds an amount ("1½ hours", "20 to 25 min") stands for: its first number times its unit, or `undefined`. */
function secondsOfAmount(quantity: string, unit: string): number | undefined {
    const value = numberOf(quantity);

    return value === undefined ? undefined : value * unitSeconds(unit);
}

/**
 * Read the one duration a line offers.
 *
 * @param line - A step line, as cooking mode shows it.
 * @returns `one` with the seconds when the line holds exactly one span of time (a range gives its low end, and
 *   "1 hour 5 minutes" is one span), `many` when it holds two or more, else `none`. Pure.
 */
export function readDuration(line: string): DurationReading {
    if (line.length > MAX_READ_LINE_CHARS) {
        return { kind: 'none' };
    }

    const spans = [...line.matchAll(SPAN)];

    // The word layer runs only when the digit layer matched no span. A span an UNREAD guard turns to none stays none.
    if (spans.length === 0) {
        return readWordDuration(line);
    }

    if (spans.length > 1) {
        return { kind: 'many' };
    }

    const [span = ''] = spans[0] ?? [];

    const at = spans[0]?.index ?? 0;

    if (UNREAD_TIME_BEFORE.test(line.slice(0, at)) || UNREAD_TIME_AFTER.test(line.slice(at + span.length))) {
        return { kind: 'none' };
    }

    const amounts = [...span.matchAll(AMOUNT)].map((amount) => ({
        seconds: secondsOfAmount(amount[1] ?? '', amount[3] ?? ''),
        highSeconds: amount[2] === undefined ? undefined : secondsOfAmount(amount[2], amount[3] ?? ''),
        rank: unitSeconds(amount[3] ?? ''),
    }));

    // An amount that is not a real number ("1/0") leaves the whole span unread, never a wrong total.
    if (amounts.some((amount) => amount.seconds === undefined)) {
        return { kind: 'none' };
    }

    // One span reads as one duration only when its units strictly fall ("1 hour 5 minutes"), never "10 minutes, 5 minutes".
    if (amounts.some((amount, index) => index > 0 && amount.rank >= (amounts[index - 1]?.rank ?? 0))) {
        return { kind: 'many' };
    }

    const bareMinutes = amounts.at(-1)?.rank === SECONDS_PER_TIME_UNIT.hour ? spans[0]?.groups?.['bare'] : undefined;
    const total =
        amounts.reduce((sum, amount) => sum + (amount.seconds ?? 0), 0) +
        (bareMinutes === undefined ? 0 : Number.parseInt(bareMinutes, 10) * 60);

    if (total <= 0) {
        return { kind: 'none' };
    }

    // Only a span that is exactly one range carries its high end.
    const [only] = amounts;

    return oneReading(total, amounts.length === 1 && bareMinutes === undefined ? only?.highSeconds : undefined);
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
