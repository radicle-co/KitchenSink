/**
 * The shared CORS policy's headers on a response the edge generates itself (ADR-0047, plan 002 C1).
 *
 * Every origin answers CORS through the `cors` middleware Nest installs from the policy's options. The edge's own
 * `401` never reaches an origin, so this adapter emits what that middleware emits on a NON-preflight response, from
 * the same options: `Access-Control-Allow-Origin` echoing an admitted `Origin`, `Vary: Origin` always,
 * `Access-Control-Allow-Credentials` when the policy grants credentials, and `Access-Control-Expose-Headers` when it
 * exposes any (`cors@2.8.6`, `lib/index.js`, `configureOrigin`, `configureCredentials`, `configureExposedHeaders`).
 * The unit suite checks every row against that middleware. Preflights are not answered here: the edge passes every
 * `OPTIONS` to the origin (`edgeRoutes.ts`).
 *
 * @pattern Adapter — the shared policy's `cors` options rendered as CloudFront response headers
 * @module
 */
import type { CloudFrontHeaders } from 'aws-lambda';

import type { AppCorsOptions } from '@kitchensink/clerk-verify';

/**
 * Whether the policy admits `origin`: an exact string match, or a pattern match, as the middleware decides it. Pure.
 *
 * @param admitted - The policy's origin list.
 * @param origin - The request's `Origin`.
 * @returns `true` when an entry admits it.
 */
function admits(admitted: AppCorsOptions['origin'], origin: string): boolean {
    return admitted.some((entry) => (typeof entry === 'string' ? entry === origin : entry.test(origin)));
}

/**
 * The CORS headers for an edge-generated response to a request from `origin`. Pure.
 *
 * An empty `Origin` gets no `Allow-Origin`, as in the middleware, which writes no header whose value is empty.
 *
 * @param options - The shared policy's options (`resolveCorsPolicy(…).options`).
 * @param origin - The request's `Origin` header value, or `undefined` when it sent none.
 * @returns CloudFront headers, keyed by lower-cased name.
 */
export function edgeCorsHeaders(options: AppCorsOptions, origin: string | undefined): CloudFrontHeaders {
    const headers: CloudFrontHeaders = {};

    if (origin !== undefined && origin !== '' && admits(options.origin, origin)) {
        headers['access-control-allow-origin'] = [{ key: 'Access-Control-Allow-Origin', value: origin }];
    }

    headers['vary'] = [{ key: 'Vary', value: 'Origin' }];

    if (options.credentials) {
        headers['access-control-allow-credentials'] = [{ key: 'Access-Control-Allow-Credentials', value: 'true' }];
    }

    if (options.exposedHeaders.length > 0) {
        headers['access-control-expose-headers'] = [
            { key: 'Access-Control-Expose-Headers', value: options.exposedHeaders.join(',') },
        ];
    }

    return headers;
}
