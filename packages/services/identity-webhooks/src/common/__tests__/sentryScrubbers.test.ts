import { describe, expect, it } from 'vitest';

import {
    isDeniedKey,
    isIdKey,
    looksLikeBearerToken,
    pseudonymizeId,
    scrubEvent,
    scrubLog,
    scrubText,
    scrubAttributes,
} from '../sentryScrubbers.js';

describe('sentry-scrubbers', () => {
    describe('isDeniedKey', () => {
        it('matches the denylist case-insensitively', () => {
            expect(isDeniedKey('Email')).toBe(true);
            expect(isDeniedKey('AUTHORIZATION')).toBe(true);
            expect(isDeniedKey('avatarUrl')).toBe(true);
            expect(isDeniedKey('id')).toBe(false);
            expect(isDeniedKey('identityId')).toBe(false);
        });
    });

    describe('looksLikeBearerToken', () => {
        it('detects JWT-shaped strings and ignores ordinary text', () => {
            expect(looksLikeBearerToken('aaaaaaaa.bbbbbbbb.cccccccc')).toBe(true);
            expect(looksLikeBearerToken('hello world')).toBe(false);
            expect(looksLikeBearerToken('a.b.c')).toBe(false);
        });
    });

    describe('scrubAttributes', () => {
        it('redacts denied keys and bearer-shaped strings, recursing nested structures', () => {
            const input = {
                email: 'a@b.com',
                id: 'u1',
                nested: { token: 'secret', note: 'ok' },
                list: ['plain', 'aaaaaaaa.bbbbbbbb.cccccccc'],
            };

            const out = scrubAttributes(input);

            expect(out.email).toBe('[redacted]');
            expect(out.id).toBe('u1');
            expect(out.nested.token).toBe('[redacted]');
            expect(out.nested.note).toBe('ok');
            expect(out.list[0]).toBe('plain');
            expect(out.list[1]).toBe('[redacted]');
        });
    });

    describe('isIdKey', () => {
        it('matches person-linked id keys case-insensitively, not bare id', () => {
            expect(isIdKey('sub')).toBe(true);
            expect(isIdKey('identityId')).toBe(true);
            expect(isIdKey('userId')).toBe(true);
            expect(isIdKey('ownerId')).toBe(true);
            expect(isIdKey('requesterId')).toBe(true);
            expect(isIdKey('clerkUserId')).toBe(true);
            expect(isIdKey('id')).toBe(false);
            expect(isIdKey('jobId')).toBe(false);
            expect(isIdKey('recipeId')).toBe(false);
        });
    });

    describe('pseudonymizeId', () => {
        it('is deterministic, prefixed, and non-reversible in shape', () => {
            const a = pseudonymizeId('user_2abcDEF');
            expect(a).toMatch(/^anon_[0-9a-f]{16}$/);
            expect(pseudonymizeId('user_2abcDEF')).toBe(a); // stable → correlation preserved
            expect(pseudonymizeId('01JQ8N2X4RBV6WK3ZT5Y7A9C0P')).not.toBe(a); // distinct inputs → distinct
            expect(a).not.toContain('user_2abcDEF'); // raw id does not survive
        });
    });

    describe('scrubEvent', () => {
        it('scrubs extra and user fields and PSEUDONYMIZES the user id', () => {
            const event = {
                extra: { email: 'a@b.com', ok: 1, ownerId: '01JQ8N2X4RBV6WK3ZT5Y7A9C0P' },
                user: { id: 'user_2abcDEFghiJKL', email: 'a@b.com', name: 'Bob' },
            } as unknown as Parameters<typeof scrubEvent>[0];

            const out = scrubEvent(event);

            expect(out.extra?.['email']).toBe('[redacted]');
            expect(out.extra?.['ok']).toBe(1);
            expect(out.extra?.['ownerId']).toBe(pseudonymizeId('01JQ8N2X4RBV6WK3ZT5Y7A9C0P'));
            expect(out.user?.id).toBe(pseudonymizeId('user_2abcDEFghiJKL'));
            expect(out.user?.id).not.toBe('user_2abcDEFghiJKL');
            expect(out.user?.['email']).toBe('[redacted]');
            expect(out.user?.['name']).toBe('[redacted]');
        });
    });

    describe('scrubAttributes id pseudonymization', () => {
        it('pseudonymizes person-linked id VALUES (stable), leaves bare id, redacts denied keys', () => {
            const input = {
                sub: 'user_2abcDEFghiJKL',
                userId: '01JQ8N2X4RBV6WK3ZT5Y7A9C0P',
                ownerId: '01JQ8N2X4RBV6WK3ZT5Y7A9C0P',
                id: 'u1',
                jobId: 'job-123',
                email: 'a@b.com',
                nested: { identityId: 'user_zzz', note: 'ok' },
            };

            const out = scrubAttributes(input);

            expect(out.sub).toBe(pseudonymizeId('user_2abcDEFghiJKL'));
            expect(out.userId).toBe(pseudonymizeId('01JQ8N2X4RBV6WK3ZT5Y7A9C0P'));
            expect(out.ownerId).toBe(out.userId); // same id → same token (correlatable)
            expect(out.id).toBe('u1'); // bare id untouched
            expect(out.jobId).toBe('job-123'); // non-person id untouched
            expect(out.email).toBe('[redacted]');
            expect(out.nested.identityId).toBe(pseudonymizeId('user_zzz'));
            expect(out.nested.note).toBe('ok');
        });
    });

    describe('scrubText', () => {
        it('redacts email and bearer-shaped substrings inside free text', () => {
            expect(scrubText('contact me at a@b.com please')).toBe('contact me at [redacted] please');
            expect(scrubText('token aaaaaaaa.bbbbbbbb.cccccccc rejected')).toBe('token [redacted] rejected');
            expect(scrubText('nothing sensitive here')).toBe('nothing sensitive here');
        });

        it('pseudonymizes an embedded Clerk sub in free text', () => {
            const sub = 'user_2abcDEFghiJKLmnopqrstuvwx'; // realistic Clerk sub length (24 chars after prefix)
            expect(scrubText(`provisioning failed for ${sub}`)).toBe(`provisioning failed for ${pseudonymizeId(sub)}`);
        });
    });

    describe('scrubEvent message + exception', () => {
        it('redacts PII in the event message and exception values', () => {
            const event = {
                message: 'failed for a@b.com',
                exception: { values: [{ value: 'token aaaaaaaa.bbbbbbbb.cccccccc invalid' }] },
            } as unknown as Parameters<typeof scrubEvent>[0];

            const out = scrubEvent(event);

            expect(out.message).toBe('failed for [redacted]');
            expect(out.exception?.values?.[0]?.value).toBe('token [redacted] invalid');
        });
    });

    describe('scrubLog', () => {
        it('drops debug logs and redacts the message body + attributes', () => {
            expect(scrubLog({ level: 'debug', message: 'x' })).toBeNull();

            const out = scrubLog({ level: 'info', message: 'user a@b.com synced', attributes: { token: 'x' } });
            expect(out?.message).toBe('user [redacted] synced');
            expect(out?.attributes?.['token']).toBe('[redacted]');
        });
    });
});
