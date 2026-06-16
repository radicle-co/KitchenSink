import * as Sentry from '@sentry/nestjs';
import { createAuthTracer, consoleSink, type TraceSink } from '@kitchensink/tracing';

/**
 * `debug:auth` facade for the identity service. Flag-gated step-by-step debug logging of the
 * sign-up → auth → DB flow, so a failure can be traced through our code. Off unless `DEBUG_AUTH` is
 * truthy (default on in sandbox via infra env, off in prod — flip the task env to debug a prod
 * issue, no code change). Local/dev → `console` (the `debug` package, `DEBUG=commise:auth`); deployed
 * → Sentry logs. Filter by `sub` in Sentry to see a single signup's whole flow.
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
