import * as Sentry from '@sentry/aws-serverless';
import type { Handler } from 'aws-lambda';

import { scrubEvent, scrubLog } from './sentry-scrubbers.js';

/**
 * Observability for the identity-webhooks Lambdas.
 *
 * Two paths (see docs/brainstorms/2026-06-11-observability-sentry-integration-requirements.md):
 * purposeful logs + errors go to the per-service Sentry project via the SDK; AWS/CloudWatch infra
 * logs drain separately. Powertools `Logger` is dropped for purposeful logging (Sentry Logs replace
 * it); EMF custom metrics are kept but emitted straight to stdout so they still reach CloudWatch
 * without being re-routed into Sentry (KTD5).
 */

const sentryDsn = process.env['SENTRY_DSN'];

if (sentryDsn) {
    Sentry.init({
        dsn: sentryDsn,
        environment: process.env['STAGE'] ?? 'dev',
        release: process.env['SENTRY_RELEASE'],
        tracesSampleRate: Number(process.env['SENTRY_TRACES_SAMPLE_RATE'] ?? '0'),
        enableLogs: true,
        sendDefaultPii: false,
        beforeSend: (event) => {
            const scrubbed = scrubEvent(event);

            // Drop bare `Unauthorized` exceptions — routine rejections (bots, bad/missing webhook
            // signatures, expired tokens) that would otherwise create a Sentry Issue per request.
            // Genuine unexpected failures surface under distinct messages (U3).
            const firstException = scrubbed.exception?.values?.[0];

            if (firstException?.value === 'Unauthorized') {
                return null;
            }

            return scrubbed;
        },
        beforeSendLog: scrubLog,
    });
}

type LogAttributes = Record<string, unknown>;

/**
 * Purposeful-logging facade backed by Sentry Logs, sent to the per-service project alongside
 * errors and traces. Keeps the `logger.info/warn/error(message, attributes)` shape the handlers
 * already use. Inert (no stdout) when Sentry is not initialized.
 *
 * @sideEffect emits a log entry to Sentry.
 */
export const logger = {
    info: (message: string, attributes?: LogAttributes): void => {
        Sentry.logger.info(message, attributes);
    },
    warn: (message: string, attributes?: LogAttributes): void => {
        Sentry.logger.warn(message, attributes);
    },
    error: (message: string, attributes?: LogAttributes): void => {
        Sentry.logger.error(message, attributes);
    },
};

let isColdStart = true;

/**
 * Wrap a Lambda handler with Sentry error capture and attach per-invocation context to the
 * isolation scope, so the AWS request id, cold-start flag, function name/version, and service name
 * appear on both error events and log entries (KTD4 / context parity).
 *
 * @sideEffect installs Sentry instrumentation around the handler.
 */
export const withObservability = <TEvent, TResult>(handler: Handler<TEvent, TResult>): Handler<TEvent, TResult> => {
    const instrumented: Handler<TEvent, TResult> = (event, context, callback) => {
        const coldStart = isColdStart;
        isColdStart = false;

        Sentry.getIsolationScope().setAttributes({
            aws_request_id: context.awsRequestId,
            cold_start: coldStart,
            function_name: context.functionName,
            function_version: context.functionVersion,
            serviceName: 'identity-webhooks',
        });

        return handler(event, context, callback);
    };

    return Sentry.wrapHandler(instrumented);
};

/**
 * Emit a CloudWatch EMF custom metric. Written straight to stdout (not through the Sentry log
 * facade) so the metric reaches CloudWatch and is excluded from the log drain by the `_aws`
 * subscription-filter term (KTD5).
 *
 * @sideEffect writes an EMF line to stdout.
 */
export const emitMetric = (metricName: string, value: number, dimensions: Record<string, string> = {}): void => {
    const dimensionsJson = JSON.stringify(dimensions);
    const payload = {
        level: 'INFO',
        message: 'metric',
        metricName,
        metricValue: value,
        metricUnit: 'Count',
        dimensions,
        _aws: {
            Timestamp: Date.now(),
            CloudWatchMetrics: [
                {
                    Namespace: 'KitchenSink/IdentityWebhooks',
                    Dimensions: [['service', 'metric', ...Object.keys(dimensions)]],
                    Metrics: [{ Name: metricName, Unit: 'Count' }],
                },
            ],
        },
        service: 'identity-webhooks',
        metric: metricName,
        dimensionsJson,
    };

    process.stdout.write(`${JSON.stringify(payload)}\n`);
};

/**
 * Emit the distinct, paging provisioning-failure signal for a genuine (non-collision) failure in a
 * sync path (webhook / reconciliation). Mirrors the identity service's `auth.provisioning: failed`
 * tag so one Sentry alert rule covers all sites. Carries only the Clerk identity id (never PII), and
 * scrubs the error message (a Postgres 23505 embeds the offending email). The expected email-collision
 * fallback returns `incomplete` instead of throwing, so it never reaches here — it must not page.
 *
 * @sideEffect captures a Sentry exception.
 */
export const captureProvisioningFailure = (err: unknown, identityId: string): void => {
    Sentry.captureException(err, {
        tags: { 'auth.provisioning': 'failed' },
        contexts: { auth: { clerkSub: identityId, outcome: 'failed' } },
    });
};
