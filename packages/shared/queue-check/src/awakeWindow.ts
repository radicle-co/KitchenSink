/**
 * The AWAKE WINDOW (plan U11, R35) — when a non-prod stage's backstop is allowed to have an opinion.
 *
 * ⛔ WHY IT EXISTS. ADR-0007 stops the sandbox tier nightly: the RDS instance and the NAT instance are shut
 * down from 00:00 to 09:00 America/New_York. During those nine hours a backstop that runs would find its
 * database unreachable and every queue apparently stalled — and would escalate, every night, in every
 * preview. A signal that fires nightly for a reason nobody can act on is a signal its reader mutes, and the
 * one time it means something is the night they do not look.
 *
 * ⛔ PROD IS ALWAYS AWAKE. It is never stopped, so there is no window to observe, and making prod's silence
 * depend on a clock would be the one way this module could hide a real outage.
 *
 * ⚠️ THE TIMEZONE IS PART OF THE DECISION, NOT A DETAIL. The schedule is `America/New_York`, which shifts
 * against UTC twice a year; computing the window in UTC would silently move it by an hour each spring and
 * autumn, so the boundary is evaluated in the zone the scheduler itself uses.
 */

/** The zone ADR-0007's nightly schedule is expressed in. The scheduler stack uses the same one. */
export const NIGHTLY_TIMEZONE = 'America/New_York';

/** The hour the sandbox tier stops (inclusive). */
export const NIGHTLY_STOP_HOUR = 0;

/** The hour the sandbox tier starts again (exclusive lower bound of the awake day). */
export const NIGHTLY_START_HOUR = 9;

/**
 * The local hour at an instant, in the nightly schedule's own timezone.
 *
 * ⚠️ Via `Intl`, not by adding an offset: the offset is what changes at a daylight-saving boundary, and a
 * hard-coded one moves this window by an hour twice a year — in opposite directions, so a test written in
 * one half of the year would pass while the other half was wrong.
 *
 * @param at - The instant.
 * @returns The hour, 0–23, in {@link NIGHTLY_TIMEZONE}. Pure.
 */
export function nightlyLocalHour(at: Date): number {
    const hour = new Intl.DateTimeFormat('en-US', {
        timeZone: NIGHTLY_TIMEZONE,
        hour: 'numeric',
        hour12: false,
    }).format(at);

    // `hour12: false` renders midnight as `24` in some ICU versions; normalise it to 0.
    return Number(hour) % 24;
}

/**
 * Whether a stage's backstop should run at this instant.
 *
 * @param stage - The deploy stage.
 * @param at - The instant.
 * @returns `true` when the stage is awake. Pure.
 */
export function isAwake(stage: string, at: Date): boolean {
    if (stage === 'prod') {
        return true;
    }

    const hour = nightlyLocalHour(at);

    return hour < NIGHTLY_STOP_HOUR || hour >= NIGHTLY_START_HOUR;
}
