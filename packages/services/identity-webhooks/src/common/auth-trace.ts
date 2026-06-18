import * as Sentry from '@sentry/aws-serverless';
import createDebug from 'debug';

/**
 * `debug:auth` facade for the identity-webhooks Lambdas. Flag-gated step-by-step debug logging of
 * the webhook → DB and reconciliation flows. Off unless `DEBUG_AUTH` is truthy (default on in
 * sandbox via infra env, off in prod). Local → `console` (the `debug` package); deployed → Sentry
 * logs. Filter by `sub` in Sentry to follow one user across the webhook + read-through paths.
 *
 * Inlined per-service deliberately (mirrors the identity service): a shared workspace package that
 * exports raw `.ts` cannot be loaded by the compiled identity Docker runtime, so the tiny facade is
 * kept per-backend rather than as a runtime cross-package import.
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
