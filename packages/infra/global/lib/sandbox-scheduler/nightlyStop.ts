/**
 * The nightly stop: the ONE clock the sandbox still has.
 *
 * ⛔ Owner ruling 2026-10-12: "no automatic or scheduled tasks or jobs except for the single one to check if the
 * sandbox is running at midnight and bringing every single sandbox down." The sandbox starts only by hand, so the
 * stop is the only time-based act left, and `SandboxSchedulerStack` is its only reader.
 *
 * These two constants used to live in `@kitchensink/queue-check`, beside `isAwake` and the 09:00 start hour,
 * which described a CLOCK that decided whether a backstop ran. That clock is deleted (a scheduled job now runs
 * while its sandbox is up), and a shared runtime package has no business exporting a constant for infrastructure.
 *
 * ⚠️ `.github/scripts/sandboxWake.sh` repeats the zone as `SANDBOX_WAKE_SCHEDULE_TZ` for its pre-midnight
 * headroom rule; `sandboxWakeWiring.test.ts` ties that copy to the synthesized schedule, not to this file.
 */

/** The hour the sandbox stops, in {@link NIGHTLY_TIMEZONE}. */
export const NIGHTLY_STOP_HOUR = 0;

/** The IANA zone the stop is expressed in. It shifts against UTC twice a year, which is why it is a zone. */
export const NIGHTLY_TIMEZONE = 'America/New_York';
