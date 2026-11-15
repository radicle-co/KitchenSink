/**
 * An ISO 8601 duration read as whole minutes (schema.org `prepTime`, `cookTime`, `totalTime`).
 *
 * DESIGN PATTERN: **Adapter** over `tinyduration`, the ONLY importer of it. The library parses; this file decides what a
 * parsed duration means for a recipe: whole minutes, or nothing.
 *
 * ⛔ A value that is not a fixed length of time is ABSENT, never guessed: a month or a year has no number of minutes, and
 * a missing time is held for the cook (ADR-0072 §3), while a wrong one is quietly believed. A stated `PT0M` is kept as
 * `0`, because "no time" and "unknown" are different facts.
 */
import { parse } from 'tinyduration';

import { recipeMinutesSchema } from '../recipeRequestBounds.js';

/** The longest text read as a duration. `P1DT23H59M59S` is 13; anything past this is not one, and costs one comparison. */
const MAX_DURATION_CHARS = 64;

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;
const MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY;
const SECONDS_PER_MINUTE = 60;

/**
 * Read `value` as a number of whole minutes.
 *
 * @param value - A JSON-LD or microdata value, normally `PT1H30M`.
 * @returns The minutes (seconds are rounded to the nearest minute), or `undefined` when it is not a string, not a valid
 *   duration, negative, counts months or years, or is past the column (`recipeMinutesSchema`). Pure.
 */
export function durationMinutes(value: unknown): number | undefined {
    if (typeof value !== 'string' || value.length > MAX_DURATION_CHARS) {
        return undefined;
    }

    let parsed: ReturnType<typeof parse>;

    try {
        parsed = parse(value.trim());
    } catch {
        return undefined;
    }

    if (parsed.negative === true || parsed.years !== undefined || parsed.months !== undefined) {
        return undefined;
    }

    const minutes =
        (parsed.weeks ?? 0) * MINUTES_PER_WEEK +
        (parsed.days ?? 0) * MINUTES_PER_DAY +
        (parsed.hours ?? 0) * MINUTES_PER_HOUR +
        (parsed.minutes ?? 0) +
        (parsed.seconds ?? 0) / SECONDS_PER_MINUTE;
    const whole = Math.round(minutes);

    const checked = recipeMinutesSchema.safeParse(whole);

    return checked.success ? checked.data : undefined;
}
