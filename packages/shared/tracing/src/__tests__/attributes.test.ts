import { describe, it, expect } from 'vitest';

import { ATTR, SPAN, PII_DENYLIST_KEYS } from '../attributes.js';

describe('tracing attribute constants', () => {
    it('names the correlation keys stably', () => {
        expect(ATTR.CLERK_SUB).toBe('clerk.sub');
        expect(ATTR.APP_USER_ID).toBe('app.user.id');
        expect(ATTR.SVIX_MESSAGE_ID).toBe('messaging.message.id');
    });

    it('exposes canonical span names for the flow', () => {
        expect(Object.values(SPAN)).toContain('auth.verify');
        expect(Object.values(SPAN)).toContain('webhook.user');
    });
});

describe('PII denylist', () => {
    it('scrubs the genuinely sensitive fields', () => {
        for (const key of ['email', 'name', 'picture', 'image_url', 'token', 'authorization']) {
            expect(PII_DENYLIST_KEYS).toContain(key);
        }
    });

    it('PRESERVES the opaque correlation identifiers (they are not PII to scrub)', () => {
        expect(PII_DENYLIST_KEYS).not.toContain('clerk.sub');
        expect(PII_DENYLIST_KEYS).not.toContain('sub');
        expect(PII_DENYLIST_KEYS).not.toContain('app.user.id');
    });
});
