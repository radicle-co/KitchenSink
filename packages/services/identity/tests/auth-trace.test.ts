import { describe, it, expect, vi } from 'vitest';

vi.mock('@sentry/nestjs', () => ({ logger: { debug: vi.fn() } }));

import { scrubAuthAttributes } from '../src/observability/auth-trace.js';

describe('scrubAuthAttributes (inlined debug:auth scrub)', () => {
    it('redacts textual PII (email, name, picture, token) but keeps sub + non-PII', () => {
        const out = scrubAuthAttributes({
            sub: 'user_x',
            email: 'a@b.com',
            name: 'Jane Doe',
            picture: 'https://x/y.png',
            token: 'tok_1',
            outcome: 'created',
        });

        expect(out).toEqual({
            sub: 'user_x',
            email: '[redacted]',
            name: '[redacted]',
            picture: '[redacted]',
            token: '[redacted]',
            outcome: 'created',
        });
    });

    it('keeps boolean/number flags whose key matches a PII substring', () => {
        const out = scrubAuthAttributes({ emailIsReal: true, nameLength: 8 });

        expect(out.emailIsReal).toBe(true);
        expect(out.nameLength).toBe(8);
    });
});
