/**
 * @module @commise/features-recipes/form — the adapter between the draft's prep and cook MINUTES (0 for "not stated")
 * and `DurationField`'s SECONDS (`undefined` for none), so a 0 shows as an empty field and never as a "0"
 * (`docs/design/uiOverhaul/buildSpec.md` §7.4).
 *
 * Pure and platform-agnostic: shared by the web and native Details leaves.
 */

/** Seconds in a minute. */
const SECONDS_PER_MINUTE = 60;

/**
 * The duration a field shows for a number of minutes. Pure.
 *
 * @param minutes - The draft's minutes.
 * @returns The duration in seconds, or `undefined` when no time is stated (0 or less).
 */
export function durationOfMinutes(minutes: number): number | undefined {
    return minutes > 0 ? minutes * SECONDS_PER_MINUTE : undefined;
}

/**
 * The minutes the draft stores for a field's duration. Pure.
 *
 * @param seconds - The field's duration, or `undefined` for none.
 * @returns Whole minutes, 0 when no time is stated.
 */
export function minutesOfDuration(seconds: number | undefined): number {
    return seconds === undefined ? 0 : Math.round(seconds / SECONDS_PER_MINUTE);
}
