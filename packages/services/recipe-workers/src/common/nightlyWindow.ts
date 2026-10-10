import { isAwake } from '@kitchensink/queue-check';

import { requireEnv } from './config.js';
import { logger } from './logger.js';

/**
 * Whether a frequently-scheduled handler stands down for ADR-0007's nightly stop (R35).
 *
 * ⛔ THE WINDOW IS NOT DEFINED HERE. `isAwake` in `@kitchensink/queue-check` is the one statement of it, and the
 * sandbox scheduler and the queue-check cron monitor read the same module; this file only applies it at a
 * handler's entry.
 *
 * ⚠️ FOR HANDLERS THAT TICK EVERY FEW MINUTES OR HOURLY ONLY. A run skipped in the window is followed by one
 * inside the awake day, so nothing is lost. A DAILY schedule whose single tick falls in the window would be
 * skipped every day — never run, never fail, never seen — so a daily job must instead be scheduled into the
 * awake hours.
 *
 * @param handlerName - The handler's log prefix.
 * @returns `true` when the stage is asleep and the handler should return without touching anything.
 * @throws {MissingConfigError} When `STAGE` is unset: guessing a stage would decide which window applies.
 * @sideEffect Reads `STAGE` and the clock; logs one line when standing down.
 */
export function standsDownForTheNight(handlerName: string): boolean {
    const stage = requireEnv('STAGE');

    if (isAwake(stage, new Date())) {
        return false;
    }

    logger.info(`${handlerName}: stage asleep for the nightly stop (ADR-0007), skipping this tick`, { stage });

    return true;
}
