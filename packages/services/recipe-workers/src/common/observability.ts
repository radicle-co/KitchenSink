/**
 * Sentry for the recipe-workers Lambdas (plan U16/U22).
 *
 * ⛔ WHY IT WAS MISSING AND WHY THAT MATTERED. These ten functions wrote structured lines to stdout and
 * nothing else. Until plan U15 their log group had no drain at all, so a thrown error reached CloudWatch and
 * stopped — no issue, no grouping, no stack trace anybody would see, no alert. The drain fixes visibility of
 * LOGS; it cannot turn a failure into an issue, because a forwarded log line is a log line.
 *
 * ⛔ AND THE TWO PATHS MUST NOT DOUBLE-COUNT. The drain forwards stdout, so an error written to stdout AND
 * captured by the SDK is one failure recorded twice — once as an issue, once as an ERROR-severity log — and
 * Sentry's alerting counts them separately. So when Sentry is initialised, `logger.error` goes to Sentry's
 * logger INSTEAD of stdout. `info` and `warn` stay on stdout, because CloudWatch is the durable record and
 * neither creates an issue.
 *
 * ⚠️ EMF METRIC LINES ARE UNTOUCHED. `metrics.ts` writes them straight to stdout and the drain's filter
 * pattern excludes `_aws`, so they reach CloudWatch as metrics and never Sentry as logs. Routing them
 * through this module would turn a metric into a log line and lose the metric.
 *
 * ⚠️ WITH NO DSN THIS IS INERT. Every local run, every unit test and every stage that has not had its
 * parameter written behaves exactly as before — `initObservability` returns `false` and `withObservability`
 * hands back the handler it was given.
 */
import * as Sentry from '@sentry/aws-serverless';
import type { Context } from 'aws-lambda';
import { scrubEvent, scrubLog } from '@kitchensink/observability-scrubbers';

/** Whether `Sentry.init` ran. Read by {@link isObservabilityEnabled} and by the logger below. */
let initialised = false;

/**
 * Initialise Sentry from the environment, once.
 *
 * ⚠️ A FUNCTION, not a module side effect, for the reason `identity-webhooks` learned: a top-level
 * `Sentry.init` runs during Lambda INIT, where a construction failure produces no structured log and no
 * metric — the invocation simply never starts and the only evidence is an absent log stream.
 *
 * @param env - The environment to read; injectable so the suite can drive both branches.
 * @returns Whether Sentry was initialised.
 * @sideEffect Configures the global Sentry client.
 */
export function initObservability(env: NodeJS.ProcessEnv = process.env): boolean {
    const dsn = env['SENTRY_DSN'];

    if (!dsn || initialised) {
        return initialised;
    }

    Sentry.init({
        dsn,
        environment: env['STAGE'] ?? 'dev',
        // ⚠️ Spread, not `release: undefined`: a release named "undefined" groups unrelated deploys, which
        // is harder to notice than no release at all.
        ...(env['SENTRY_RELEASE'] === undefined ? {} : { release: env['SENTRY_RELEASE'] }),
        tracesSampleRate: Number(env['SENTRY_TRACES_SAMPLE_RATE'] ?? '0'),
        enableLogs: true,
        sendDefaultPii: false,
        beforeSend: scrubEvent,
        beforeSendLog: scrubLog,
    });

    initialised = true;

    return true;
}

/** Whether Sentry is live in this process. */
export function isObservabilityEnabled(): boolean {
    return initialised;
}

let isColdStart = true;

/**
 * Wrap a Lambda handler so a thrown error becomes a Sentry ISSUE, with per-invocation context.
 *
 * ⛔ An ISSUE, not a log line. That is the whole difference this module makes: the log drain (U15) already
 * carries the stdout line, and a forwarded log line is a log line — it does not group, it does not carry a
 * stack trace Sentry can symbolicate, and nothing alerts on it. Errors and logs are different products.
 *
 * @param handler - The Lambda handler.
 * @returns The wrapped handler, or the original one when Sentry is not initialised.
 * @sideEffect Installs Sentry instrumentation around the handler.
 */
export function withObservability<F extends (...args: never[]) => unknown>(handler: F): F {
    if (!initialised) {
        return handler;
    }

    const instrumented = ((...args: unknown[]): unknown => {
        const context = args[1] as Context | undefined;
        const coldStart = isColdStart;
        isColdStart = false;

        // ⚠️ Every attribute is OPTIONAL-safe. Half these functions are SCHEDULED — invoked by EventBridge
        // with no SQS event and, in the unit suite, called with no arguments at all — so reading
        // `context.awsRequestId` unguarded would turn "Sentry is enabled" into "every scheduled handler
        // throws on entry", which is the worst possible way for an observability change to fail.
        Sentry.getIsolationScope().setAttributes({
            aws_request_id: context?.awsRequestId ?? 'none',
            cold_start: coldStart,
            function_name: context?.functionName ?? 'unknown',
            function_version: context?.functionVersion ?? 'unknown',
            serviceName: 'recipe-workers',
        });

        return (handler as unknown as (...inner: unknown[]) => unknown)(...args);
    }) as unknown as F;

    // ⛔ The cast is to `F`, not to `Handler`, and the reason is that these ten functions do NOT share one
    // signature: the SQS consumers take `(event, context)`, the scheduled sweepers take nothing, and the
    // unit suites call the scheduled ones with no arguments. Typing this as `Handler<TEvent, TResult>` would
    // have forced every one of those call sites to invent an event and a context — editing tests to satisfy
    // a wrapper rather than because behaviour changed, which is exactly the edit `CLAUDE.md` calls the worst
    // outcome available. Preserving `F` keeps each handler's own contract intact.
    return Sentry.wrapHandler(instrumented as never) as unknown as F;
}

/**
 * Report an error line to Sentry rather than stdout.
 *
 * ⛔ INSTEAD OF, not as well as. The drain forwards stdout, so a line written in both places is one failure
 * recorded twice — once as an issue if it also throws, and once as an ERROR-severity log — and Sentry's
 * alerting counts them separately.
 *
 * @param message - The log message.
 * @param attributes - Structured attributes, scrubbed by `beforeSendLog`.
 * @returns Whether the line was taken by Sentry (so the caller knows not to write it).
 * @sideEffect Emits a Sentry log entry.
 */
export function reportErrorLine(message: string, attributes?: Record<string, unknown>): boolean {
    if (!initialised) {
        return false;
    }

    Sentry.logger.error(message, attributes);

    return true;
}

/**
 * Capture an error that is handled rather than thrown.
 *
 * ⚠️ For the paths that swallow deliberately — a metered-and-swallowed verdict write, a best-effort settle —
 * where the whole point is that the handler continues. Those are exactly the failures nothing else records.
 *
 * @param error - The caught error.
 * @param context - Identifiers describing where it happened. Never payload text.
 * @sideEffect Emits a Sentry issue.
 */
export function captureHandled(error: unknown, context: Record<string, string | number | boolean>): void {
    if (!initialised) {
        return;
    }

    Sentry.withScope((scope) => {
        scope.setContext('work_unit', context);
        Sentry.captureException(error);
    });
}
