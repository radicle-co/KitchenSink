import { describe, it, expect } from 'vitest';

import { scrubAuthAttributes } from '../scrub.js';

describe('scrubAuthAttributes', () => {
    it('redacts PII keys (email, name, picture, token, authorization)', () => {
        const out = scrubAuthAttributes({
            email: 'a@b.com',
            first_name: 'Jane',
            picture: 'https://x/y.png',
            authorization: 'Bearer abc',
            token: 'tok_123',
        });

        expect(out).toEqual({
            email: '[redacted]',
            first_name: '[redacted]',
            picture: '[redacted]',
            authorization: '[redacted]',
            token: '[redacted]',
        });
    });

    it('PRESERVES the opaque correlation identifiers and non-PII fields', () => {
        const out = scrubAuthAttributes({ sub: 'user_x', azp: 'https://sandbox.commise.app', outcome: 'created' });

        expect(out).toEqual({ sub: 'user_x', azp: 'https://sandbox.commise.app', outcome: 'created' });
    });

    it('matches PII keys case-insensitively and by substring', () => {
        const out = scrubAuthAttributes({ userEmail: 'a@b.com', imageUrl: 'https://x' });

        expect(out.userEmail).toBe('[redacted]');
        expect(out.imageUrl).toBe('[redacted]');
    });

    it('keeps boolean/number flags even when the key matches a PII substring', () => {
        // `emailIsReal: true` is a flag, not an email value — redacting it loses useful debug signal.
        const out = scrubAuthAttributes({ emailIsReal: true, nameLength: 11 });

        expect(out.emailIsReal).toBe(true);
        expect(out.nameLength).toBe(11);
    });
});
