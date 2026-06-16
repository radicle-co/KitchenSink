import { describe, it, expect } from 'vitest';

import { buildCorsOptions } from '../src/config/cors.js';

describe('buildCorsOptions', () => {
    it('pins the explicit authorized-parties allowlist on deployed stages (credentials-safe, non-wildcard)', () => {
        const origins = ['https://sandbox.commise.app', 'https://app.commise.app'];
        const opts = buildCorsOptions(origins);

        expect(opts.origin).toEqual(origins);
        expect(opts.credentials).toBe(true);
    });

    it('reflects the request origin when no parties are configured (dev/local)', () => {
        const opts = buildCorsOptions([]);

        // `true` reflects the caller's origin — credentials-compatible, unlike a `*` wildcard.
        expect(opts.origin).toBe(true);
        expect(opts.credentials).toBe(true);
    });

    it('allows the distributed-tracing headers through preflight', () => {
        const opts = buildCorsOptions(['https://sandbox.commise.app']);

        expect(opts.allowedHeaders).toContain('sentry-trace');
        expect(opts.allowedHeaders).toContain('baggage');
        expect(opts.allowedHeaders).toContain('Authorization');
    });
});
