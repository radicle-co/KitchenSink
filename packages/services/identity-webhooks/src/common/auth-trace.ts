import * as Sentry from '@sentry/aws-serverless';
import { createAuthTracer, consoleSink, type TraceSink } from '@kitchensink/tracing';

/**
 * `debug:auth` facade for the identity-webhooks Lambdas. Flag-gated step-by-step debug logging of
 * the webhook → DB and reconciliation flows. Off unless `DEBUG_AUTH` is truthy (default on in
 * sandbox via infra env, off in prod). Local → `console` (the `debug` package); deployed → Sentry
 * logs. Filter by `sub` in Sentry to follow one user across the webhook + read-through paths.
 */
const NON_DEPLOYED_STAGES = new Set(['dev', 'test', 'local']);

const isAuthDebugEnabled = (): boolean => {
    const flag = process.env['DEBUG_AUTH'];

    return flag === '1' || flag === 'true';
};

const sentrySink: TraceSink = (step, attributes) => {
    Sentry.logger.debug(`auth: ${step}`, attributes);
};

const stage = process.env['STAGE'] ?? 'dev';
const sink: TraceSink = NON_DEPLOYED_STAGES.has(stage) ? consoleSink : sentrySink;

/** @sideEffect emits a debug entry (console/Sentry) when DEBUG_AUTH is enabled. */
export const traceAuth = createAuthTracer(isAuthDebugEnabled(), sink);
