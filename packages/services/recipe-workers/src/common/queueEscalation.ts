/**
 * The backstop's Sentry binding for recipe-workers (plan U12).
 *
 * ⛔ SIX LINES, because the binding itself lives ONCE — in `@kitchensink/queue-check`'s `queueEscalation.ts`.
 * This file was a ~90-line copy of that module, as were its two siblings, each justified by a claim that the
 * SDK differed between them. It does not: `captureMessage`, `withScope` and `captureCheckIn` are the SAME
 * FUNCTION OBJECTS in `@sentry/aws-serverless`, `@sentry/nestjs` and `@sentry/core`. So the SDK is passed as
 * a PORT and the shared module depends on none of them, which is the property the copies were protecting.
 *
 * ⛔ IT DOES NOT INITIALISE. `common/observability.ts` owns `Sentry.init` for this package, before
 * any handler runs. A second `init` here would either be a no-op or would replace a correctly-configured
 * client with one built from whatever this module happened to read.
 */
import { captureCheckIn, captureMessage, withScope } from '@sentry/aws-serverless';
import { createQueueEscalation } from '@kitchensink/queue-check';

/**
 * How often the check runs, in minutes.
 *
 * ⛔ This number and the EventBridge rule's rate in `RecipeWorkersStack.ts` are the SAME cadence, held
 * together by `__tests__/queueCheckCadence.test.ts`, which READS both. A monitor expecting a check-in more
 * often than the rule fires reports a missed check-in every interval — a permanently-failing monitor for a
 * check running exactly as designed, which is how a real alert gets muted.
 */
export const QUEUE_CHECK_INTERVAL_MINUTES = 5;

const { escalate, checkInQueueCheck } = createQueueEscalation(
    { withScope, captureMessage, captureCheckIn },
    { service: 'recipe-workers', intervalMinutes: QUEUE_CHECK_INTERVAL_MINUTES },
);

export { checkInQueueCheck, escalate };
