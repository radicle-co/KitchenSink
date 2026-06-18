import * as Sentry from '@sentry/nestjs';
import createDebug from 'debug';

/**
 * `debug:auth` facade for the identity service. Flag-gated step-by-step debug logging of the
 * sign-up → auth → DB flow, so a failure can be traced through our code. Off unless `DEBUG_AUTH` is
 * truthy (default on in sandbox via infra env, off in prod — flip the task env to debug a prod
 * issue, no code change). Local/dev → `console` (the `debug` package, `DEBUG=commise:auth`); deployed
 * → Sentry logs. Filter by `sub` in Sentry to see a single signup's whole flow.
 *
 * Inlined per-service deliberately: a shared workspace package that exports raw `.ts` cannot be
 * loaded by the compiled Docker runtime (`node dist/main.js`) — it triggered an ECS boot crash-loop.
 * The facade is tiny, so each backend keeps its own copy rather than a runtime cross-package import.
 */
type Attributes = Record<string, unknown>;

const PII_DENYLIST_SUBSTRINGS = [
    'email',
    'name',
    'picture',
    'image',
    'avatar',
    'password',
    'token',
    'authorization',
    'secret',
];

/** Redact textual PII by key-substring match; keep boolean/number flags (e.g. `emailIsReal: true`). */
export const scrubAuthAttributes = (attributes: Attributes): Attributes => {
    const out: Attributes = {};

    for (const [key, value] of Object.entries(attributes)) {
        const sensitive = PII_DENYLIST_SUBSTRINGS.some((deny) => key.toLowerCase().includes(deny));
        const safeScalar = typeof value === 'boolean' || typeof value === 'number';
        out[key] = sensitive && !safeScalar ? '[redacted]' : value;
    }

    return out;
};

const NON_DEPLOYED_STAGES = new Set(['dev', 'test', 'local']);

const isAuthDebugEnabled = (): boolean => {
    const flag = process.env['DEBUG_AUTH'];

    return flag === '1' || flag === 'true';
};

const debugLog = createDebug('commise:auth');
const consoleSink = (step: string, attributes: Attributes): void => debugLog('%s %o', step, attributes);
const sentrySink = (step: string, attributes: Attributes): void => Sentry.logger.debug(`auth: ${step}`, attributes);

const stage = process.env['STAGE'] ?? 'dev';
const sink = NON_DEPLOYED_STAGES.has(stage) ? consoleSink : sentrySink;
const enabled = isAuthDebugEnabled();

/** @sideEffect emits a debug entry (console/Sentry) when DEBUG_AUTH is enabled. */
export const traceAuth = (step: string, attributes: Attributes = {}): void => {
    if (!enabled) {
        return;
    }

    sink(step, scrubAuthAttributes(attributes));
};
