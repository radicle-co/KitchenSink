/**
 * @module @commise/ui/duration-field — the hours/minutes arithmetic for a duration stored in seconds.
 *
 * A step timer is stored in seconds. People read and type it in hours and minutes, so every surface that shows or
 * edits one goes through these two functions and the two directions cannot disagree. Pure, no platform code.
 *
 * Rounding is to the nearest minute, with one exception: a positive duration never rounds to nothing. A 20-second
 * timer the cook set (or that an import carried) shows as "1 min" rather than vanishing.
 */

/** A duration said in whole hours and minutes. `minutes` is 0–59. */
export interface DurationParts {
    readonly hours: number;
    readonly minutes: number;
}

const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;

/**
 * Split a stored duration into whole hours and minutes.
 *
 * @param seconds - The stored duration, or `undefined` when there is none.
 * @returns The parts, or `undefined` for no duration (absent, zero or negative).
 */
export function splitDuration(seconds: number | undefined): DurationParts | undefined {
    if (seconds === undefined || !(seconds > 0)) {
        return undefined;
    }

    const totalMinutes = Math.max(1, Math.round(seconds / SECONDS_PER_MINUTE));

    return { hours: Math.floor(totalMinutes / MINUTES_PER_HOUR), minutes: totalMinutes % MINUTES_PER_HOUR };
}

/**
 * Join hours and minutes into the stored duration in seconds.
 *
 * @param hours - Whole hours (0 or more).
 * @param minutes - Whole minutes (0 or more; values past 59 carry into the hours).
 * @returns The duration in seconds, or `undefined` when both are zero (no duration).
 */
export function joinDuration(hours: number, minutes: number): number | undefined {
    const seconds = (hours * MINUTES_PER_HOUR + minutes) * SECONDS_PER_MINUTE;

    return seconds > 0 ? seconds : undefined;
}

/** What a duration field's two boxes show: whole numbers as text, or empty. */
export interface DurationBoxes {
    readonly hours: string;
    readonly minutes: string;
}

/**
 * What the hours and minutes boxes show for a stored duration. An empty box means "none", so a box never shows "0":
 * a duration under an hour leaves the hours box empty, and a whole hour leaves the minutes box empty.
 *
 * @param seconds - The stored duration, or `undefined`.
 * @returns The two boxes' text.
 */
export function durationBoxes(seconds: number | undefined): DurationBoxes {
    const parts = splitDuration(seconds);

    return {
        hours: parts === undefined || parts.hours === 0 ? '' : String(parts.hours),
        minutes: parts === undefined || parts.minutes === 0 ? '' : String(parts.minutes),
    };
}

/** Read one box: a whole number of 0 or more, with anything empty, unreadable or negative read as 0. */
function readBox(text: string): number {
    const value = Number.parseInt(text, 10);

    return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * The stored duration for what the two boxes say.
 *
 * @param hoursText - The hours box's text.
 * @param minutesText - The minutes box's text.
 * @returns The duration in seconds, or `undefined` when both boxes say nothing (or zero).
 */
export function durationFromBoxes(hoursText: string, minutesText: string): number | undefined {
    return joinDuration(readBox(hoursText), readBox(minutesText));
}
