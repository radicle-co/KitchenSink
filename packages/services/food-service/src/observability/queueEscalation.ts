/**
 * The backstop's Sentry binding for food-service (plan U13).
 *
 * ⛔ SIX LINES, because the binding itself lives ONCE — in `@kitchensink/queue-check`'s `queueEscalation.ts`.
 * This file was a ~90-line copy of that module, as were its two siblings, each justified by a claim that the
 * SDK differed between them. It does not: `captureMessage`, `withScope` and `captureCheckIn` are the SAME
 * FUNCTION OBJECTS in `@sentry/aws-serverless`, `@sentry/nestjs` and `@sentry/core`. So the SDK is passed as
 * a PORT and the shared module depends on none of them, which is the property the copies were protecting.
 *
 * ⛔ IT DOES NOT INITIALISE. `src/instrument.ts` does, loaded by `node --import` before anything else,
 * because `@sentry/nestjs` patches modules as they LOAD. This module exists for the parts of the WORKER
 * that report something which is not an unhandled exception — the backstop's findings, which are
 * deliberate rather than crashes and have no NestJS exception filter in front of them.
 */
import { captureCheckIn, captureMessage, withScope } from '@sentry/nestjs';
import { createQueueEscalation } from '@kitchensink/queue-check';

import { DEFAULT_REAP_INTERVAL_MS } from '../worker/reapInterval.js';

/**
 * How often the check runs, in minutes.
 *
 * ⛔ IT IS THE REAPER'S CADENCE, because the check rides the reaper's tick rather than a schedule of its own
 * (U13). That is what makes this monitor a statement about the DRAINER: a drainer that dies takes the check
 * with it, and the missed check-ins name the cause instead of leaving an operator to infer it from a
 * backlog. Derived from `DEFAULT_REAP_INTERVAL_MS` rather than written down twice.
 */
export const QUEUE_CHECK_INTERVAL_MINUTES = Math.max(1, Math.round(DEFAULT_REAP_INTERVAL_MS / 60_000));

const { escalate, checkInQueueCheck } = createQueueEscalation(
    { withScope, captureMessage, captureCheckIn },
    { service: 'food-service', intervalMinutes: QUEUE_CHECK_INTERVAL_MINUTES },
);

export { checkInQueueCheck, escalate };
