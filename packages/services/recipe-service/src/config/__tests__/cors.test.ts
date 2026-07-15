import { describe, expect, it } from 'vitest';

import { buildCorsOptions } from '../cors.js';

describe('buildCorsOptions', () => {
    it('pins the exact origin allowlist when authorized parties are configured (prod list mode)', () => {
        const opts = buildCorsOptions(['https://commise.app', 'https://www.commise.app']);

        expect(opts.origin).toEqual(['https://commise.app', 'https://www.commise.app']);
        expect(opts.credentials).toBe(true);
    });

    it('reflects the request origin (true) when no parties are configured (pattern mode / local)', () => {
        expect(buildCorsOptions([]).origin).toBe(true);
    });

    it('allows the Authorization + tracing headers through the preflight', () => {
        expect(buildCorsOptions([]).allowedHeaders).toEqual([
            'Content-Type',
            'Authorization',
            'sentry-trace',
            'baggage',
        ]);
    });
});
