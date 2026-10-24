/**
 * The drainer's reaper cadence — ONE number, because two things now depend on it.
 *
 * ⛔ IT LIVES ALONE RATHER THAN INSIDE `WorkerRuntime.ts` so the backstop's cron monitor can state the SAME
 * cadence without importing the runtime (which would drag `pg` and the whole drainer into a module that only
 * needs an integer). A monitor expecting a check-in more often than the reaper ticks reports a miss every
 * interval; one expecting it less often lets a dead drainer go unnoticed for as long as the gap. Neither
 * failure is visible from either file alone, which is exactly why the number is not written down twice.
 */

/** Default reaper cadence (ms) — the reaper also runs once at start (FR-018). */
export const DEFAULT_REAP_INTERVAL_MS = 60_000;
