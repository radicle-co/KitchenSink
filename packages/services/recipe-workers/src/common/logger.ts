import { Logger } from '@aws-lambda-powertools/logger';
import type { LogItemExtraInput, LogItemMessage } from '@aws-lambda-powertools/logger/types';

import { scrubAttributes } from '@kitchensink/observability-scrubbers';

import { collapseLogLine } from './logLine.js';
import { reportErrorLine } from './observability.js';

/**
 * Shared structured logger for the recipe-workers Lambdas. `serviceName` and the ambient
 * `POWERTOOLS_*` / `LOG_LEVEL` env vars flow into every emitted line so CloudWatch entries are
 * queryable per service.
 *
 * Every extra-attributes argument is deep-scrubbed (`scrubAttributes`) before it reaches
 * CloudWatch: person-linked ids (`ownerId`, `userId`, …) are pseudonymized and secrets redacted, so
 * an erased user's identifiers do not survive in log copies (GDPR Art. 17 / Art. 5). Only
 * `info`/`warn`/`error` are exposed — the whole recipe-workers surface uses those.
 */
const base = new Logger({ serviceName: 'recipe-workers' });

/**
 * ⛔ THE SHARED DENYLIST, not a local copy. This called `scrubLogInput` from `common/logScrub.ts` — a FOURTH
 * copy of the one list of what may not leave a host — whose stated reason for existing was that "these
 * Lambdas bundle independently (esbuild)". That is the same claim `queueEscalation.ts` measured and refuted
 * for the Sentry SDK, and this package ALREADY imports `@kitchensink/observability-scrubbers` in
 * `common/observability.ts`, so the bundling argument never applied here at all.
 *
 * ⚠️ The one behaviour the copy had and the shared module did not — an `Error` passing through whole,
 * because `message` and `stack` are non-enumerable and a structural walk returns `{}` — moved into
 * `scrubUnknown` BEFORE the copy was deleted, with its own test. Deleting first would have silently emptied
 * every error this package logs.
 */
const scrubExtra = (extra: LogItemExtraInput): LogItemExtraInput =>
    // ⚠️ NO CASTS. `scrubAttributes` is `<T>(value: T) => T`, so it preserves each entry's own type — the
    // `as Record<string, unknown>` claimed every entry was an object (the union also admits `Error` and
    // `string`) and then forced a compensating `as LogItemExtraInput` to undo the damage. Two casts that
    // cancelled out, and between them the compiler could not see the shape at all.
    extra.map((entry) => scrubAttributes(entry)) as LogItemExtraInput;

/**
 * Route an error line to Sentry when it will be taken there, and to stdout otherwise.
 *
 * ⛔ INSTEAD OF, NOT AS WELL AS, and this is the whole point of the function. Under ADR-0042 every one of
 * these functions' stdout is forwarded to the `kitchensink-log-drain` Sentry project by a subscription
 * filter. An error written to stdout AND sent through the SDK is therefore ONE failure recorded twice, in
 * two different projects, which Sentry's alerting counts separately. `common/observability.ts:9-13` has
 * stated that rule since U16; until now nothing called `reportErrorLine`, so the rule was a comment.
 *
 * ⛔ AND THE FALLBACK IS NOT OPTIONAL. `Sentry.logger.error` with no client initialised emits nothing at
 * all — no stream write, no throw. Diverting unconditionally would not move these lines, it would DELETE
 * them on every local run, in the whole unit and integration tier, and on any stage whose `SENTRY_DSN`
 * parameter is unwritten. `reportErrorLine` answers whether Sentry took the line; only `true` suppresses
 * the stdout write.
 *
 * ⚠️ `info` and `warn` are deliberately NOT routed here. Neither creates an issue, CloudWatch is their
 * durable record, and sending them would add log volume to an org already shedding 1,680 events to rate
 * limits in 30 days.
 *
 * @param message - The message argument as Powertools received it.
 * @param extra - The already-scrubbed variadic tail.
 * @returns Whether Sentry took the line, so the caller knows to skip stdout.
 * @sideEffect Emits a Sentry log entry when Sentry is initialised.
 */
const divertError = (message: LogItemMessage, extra: LogItemExtraInput): boolean => {
    const line = collapseLogLine(message, extra);

    return reportErrorLine(line.message, line.attributes);
};

/** @sideEffect emits scrubbed structured log lines to stdout → CloudWatch, or errors to Sentry. */
export const logger = {
    info: (message: LogItemMessage, ...extra: LogItemExtraInput): void => base.info(message, ...scrubExtra(extra)),
    warn: (message: LogItemMessage, ...extra: LogItemExtraInput): void => base.warn(message, ...scrubExtra(extra)),
    error: (message: LogItemMessage, ...extra: LogItemExtraInput): void => {
        const scrubbed = scrubExtra(extra);

        if (divertError(message, scrubbed)) {
            return;
        }

        base.error(message, ...scrubbed);
    },
};
