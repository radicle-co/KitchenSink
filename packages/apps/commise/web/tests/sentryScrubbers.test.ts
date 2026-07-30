import { describe, expect, it } from 'vitest';

import { isDeniedKey, looksLikeBearerToken, scrubAttributes, scrubEvent, scrubLog } from '@/lib/sentryScrubbers';

describe('sentry-scrubbers (web)', () => {
    it('redacts denied keys and bearer-shaped strings', () => {
        expect(isDeniedKey('Authorization')).toBe(true);
        expect(isDeniedKey('id')).toBe(false);
        expect(looksLikeBearerToken('aaaaaaaa.bbbbbbbb.cccccccc')).toBe(true);

        const out = scrubAttributes({ email: 'a@b.com', id: 'u1', nested: { token: 'x' } });
        expect(out.email).toBe('[redacted]');
        expect(out.id).toBe('u1');
        expect(out.nested.token).toBe('[redacted]');
    });

    it('scrubs an event but keeps user.id', () => {
        const out = scrubEvent({
            extra: { email: 'a@b.com' },
            user: { id: 'u1', email: 'a@b.com' },
        } as unknown as Parameters<typeof scrubEvent>[0]);
        expect(out.extra?.['email']).toBe('[redacted]');
        expect(out.user?.id).toBe('u1');
    });

    it('drops debug logs and scrubs attributes', () => {
        expect(scrubLog({ level: 'debug', attributes: {} })).toBeNull();
        const kept = scrubLog({ level: 'info', attributes: { email: 'a@b.com', ok: 1 } });
        expect(kept?.attributes?.['email']).toBe('[redacted]');
        expect(kept?.attributes?.['ok']).toBe(1);
    });
});
