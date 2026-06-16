import createDebug from 'debug';

import { scrubAuthAttributes } from './scrub.js';

/** Where an enabled trace call routes its output (console locally / Sentry in deployed stages). */
export type TraceSink = (step: string, attributes: Record<string, unknown>) => void;

/** Flag-gated auth-flow debug tracer. A no-op when disabled. */
export type AuthTracer = (step: string, attributes?: Record<string, unknown>) => void;

/** `debug`-package namespace for local development (`DEBUG=commise:auth` to see output). */
export const AUTH_DEBUG_NAMESPACE = 'commise:auth';

/**
 * Console sink backed by the `debug` package, for local development. Honors the `DEBUG` env var
 * namespace filter (`DEBUG=commise:auth`).
 */
export const consoleSink: TraceSink = (() => {
    const log = createDebug(AUTH_DEBUG_NAMESPACE);

    return (step, attributes) => log('%s %o', step, attributes);
})();

/**
 * Build a flag-gated auth-flow debug tracer (the `debug:auth` facade). When `enabled` is false it
 * returns a zero-cost no-op. When enabled, each `traceAuth(step, attrs)` call scrubs PII from the
 * attributes and routes them through `sink` — the runtime supplies `consoleSink` locally or a
 * Sentry-backed sink in deployed stages. Pass the same step strings across runtimes so a signup's
 * whole flow reads coherently when filtered by `sub`.
 *
 * @sideEffect emits a debug entry through `sink` when enabled.
 */
export const createAuthTracer = (enabled: boolean, sink: TraceSink): AuthTracer => {
    if (!enabled) {
        return () => {
            /* disabled — no-op */
        };
    }

    return (step, attributes = {}) => sink(step, scrubAuthAttributes(attributes));
};
