/**
 * Sentry for the remote search function, as recipe-workers has it (`recipe-workers/src/common/observability.ts`):
 * initialised from the environment once, inert with no DSN, and the destination of every error line once it is live.
 *
 * The function's handler never throws (every failure is answered with a typed response and one log line), so there is
 * no handler to wrap: what reaches Sentry is the error line, carrying only the typed fields the logger port allows.
 *
 * @module
 */
import * as Sentry from '@sentry/aws-serverless';
import { scrubEvent, scrubLog } from '@kitchensink/observability-scrubbers';

import type { SearchLogAttributes } from '../logging/searchLogAttributes.js';
import type { SourceEnvironment } from '../sources/remoteSourceAdapter.js';

/** Whether `Sentry.init` ran in this process. */
let initialised = false;

/** How long an invocation waits, at most, for Sentry to send what it buffered. */
const FLUSH_TIMEOUT_MS = 2_000;

/**
 * Initialise Sentry from the environment, once.
 *
 * @param env - The environment: `SENTRY_DSN`, `STAGE` and `SENTRY_RELEASE`.
 * @returns Whether Sentry is live.
 * @sideEffect Configures the global Sentry client.
 */
export function initObservability(env: SourceEnvironment): boolean {
    const dsn = env['SENTRY_DSN'];

    if (dsn === undefined || dsn === '' || initialised) {
        return initialised;
    }

    Sentry.init({
        dsn,
        environment: env['STAGE'] ?? 'dev',
        ...(env['SENTRY_RELEASE'] === undefined ? {} : { release: env['SENTRY_RELEASE'] }),
        enableLogs: true,
        sendDefaultPii: false,
        beforeSend: scrubEvent,
        beforeSendLog: scrubLog,
    });

    initialised = true;

    return true;
}

/**
 * Hand an error line to Sentry instead of stdout. Instead of, not as well as: the drain forwards stdout (ADR-0042), so
 * a line written to both would be one failure recorded twice.
 *
 * @param message - The line's message.
 * @param attributes - Its fields.
 * @returns Whether Sentry took the line, so the caller writes it nowhere else.
 * @sideEffect Emits a Sentry log entry when Sentry is live.
 */
export function reportErrorLine(message: string, attributes: SearchLogAttributes): boolean {
    if (!initialised) {
        return false;
    }

    Sentry.logger.error(message, { ...attributes });

    return true;
}

/**
 * Send what Sentry has buffered, before the invocation returns. Sentry sends log entries on a timer, and Lambda may
 * freeze the container the moment the handler returns, which would strand a line {@link reportErrorLine} kept off
 * stdout. Nothing to do while Sentry is not live.
 *
 * @sideEffect Waits up to two seconds for Sentry's transport to drain.
 */
export async function flushObservability(): Promise<void> {
    if (!initialised) {
        return;
    }

    await Sentry.flush(FLUSH_TIMEOUT_MS);
}
