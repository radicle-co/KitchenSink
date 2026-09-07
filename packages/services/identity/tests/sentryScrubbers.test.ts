import { describe, expect, it } from 'vitest';

import {
    isDeniedKey,
    isIdKey,
    looksLikeBearerToken,
    pseudonymizeId,
    scrubAttributes,
    scrubEvent,
    scrubLog,
    scrubText,
} from '../src/observability/sentryScrubbers.js';

describe('sentry-scrubbers', () => {
    describe('isDeniedKey', () => {
        it('matches the denylist case-insensitively', () => {
            expect(isDeniedKey('Email')).toBe(true);
            expect(isDeniedKey('picture')).toBe(true);
            expect(isDeniedKey('id')).toBe(false);
        });
    });

    describe('isIdKey', () => {
        it('matches person-linked id keys, not bare id / non-person ids', () => {
            for (const k of ['sub', 'clerkSub', 'clerkUserId', 'identityId', 'userId', 'ownerId', 'requesterId']) {
                expect(isIdKey(k)).toBe(true);
            }

            expect(isIdKey('id')).toBe(false);
            expect(isIdKey('jobId')).toBe(false);
            expect(isIdKey('recipeId')).toBe(false);
        });
    });

    describe('pseudonymizeId', () => {
        it('is deterministic, prefixed, and does not leak the raw id', () => {
            const raw = 'user_2abcDEFghiJKLmnopqrstuvwx';
            const token = pseudonymizeId(raw);
            expect(token).toMatch(/^anon_[0-9a-f]{16}$/);
            expect(pseudonymizeId(raw)).toBe(token); // stable → correlation preserved
            expect(pseudonymizeId('01JQ8N2X4RBV6WK3ZT5Y7A9C0P')).not.toBe(token);
            expect(token).not.toContain(raw);
        });
    });

    describe('looksLikeBearerToken', () => {
        it('detects JWT-shaped strings and ignores ordinary text', () => {
            expect(looksLikeBearerToken('aaaaaaaa.bbbbbbbb.cccccccc')).toBe(true);
            expect(looksLikeBearerToken('hello world')).toBe(false);
        });
    });

    describe('scrubAttributes', () => {
        it('redacts denied keys, pseudonymizes id-key VALUES (stable), leaves bare/non-person ids', () => {
            const out = scrubAttributes({
                email: 'a@b.com',
                id: 'u1',
                jobId: 'job-1',
                sub: 'user_2abcDEFghiJKLmnopqrstuvwx',
                userId: '01JQ8N2X4RBV6WK3ZT5Y7A9C0P',
                ownerId: '01JQ8N2X4RBV6WK3ZT5Y7A9C0P',
                nested: { identityId: 'user_zzzyyyxxxwwwvvvuuutttsss', name: 'Bob', note: 'ok' },
            });

            expect(out.email).toBe('[redacted]');
            expect(out.id).toBe('u1'); // bare id untouched
            expect(out.jobId).toBe('job-1'); // non-person id untouched
            expect(out.sub).toBe(pseudonymizeId('user_2abcDEFghiJKLmnopqrstuvwx'));
            expect(out.userId).toBe(pseudonymizeId('01JQ8N2X4RBV6WK3ZT5Y7A9C0P'));
            expect(out.ownerId).toBe(out.userId); // same id → same token (correlatable)
            expect(out.nested.identityId).toBe(pseudonymizeId('user_zzzyyyxxxwwwvvvuuutttsss'));
            expect(out.nested.name).toBe('[redacted]');
            expect(out.nested.note).toBe('ok');
        });
    });

    describe('scrubEvent', () => {
        it('scrubs extra/contexts and PSEUDONYMIZES the user id + id-bearing context', () => {
            const event = {
                extra: { email: 'a@b.com', ok: 1, ownerId: '01JQ8N2X4RBV6WK3ZT5Y7A9C0P' },
                contexts: { auth: { clerkSub: 'user_2abcDEFghiJKLmnopqrstuvwx' } },
                user: { id: 'user_2abcDEFghiJKLmnopqrstuvwx', email: 'a@b.com' },
            } as unknown as Parameters<typeof scrubEvent>[0];

            const out = scrubEvent(event);

            expect(out.extra?.['email']).toBe('[redacted]');
            expect(out.extra?.['ok']).toBe(1);
            expect(out.extra?.['ownerId']).toBe(pseudonymizeId('01JQ8N2X4RBV6WK3ZT5Y7A9C0P'));
            expect((out.contexts?.['auth'] as { clerkSub?: string })?.clerkSub).toBe(
                pseudonymizeId('user_2abcDEFghiJKLmnopqrstuvwx'),
            );
            expect(out.user?.id).toBe(pseudonymizeId('user_2abcDEFghiJKLmnopqrstuvwx'));
            expect(out.user?.id).not.toBe('user_2abcDEFghiJKLmnopqrstuvwx');
            expect(out.user?.['email']).toBe('[redacted]');
        });
    });

    describe('scrubText', () => {
        it('redacts email/bearer and pseudonymizes an embedded Clerk sub', () => {
            expect(scrubText('contact a@b.com')).toBe('contact [redacted]');
            const sub = 'user_2abcDEFghiJKLmnopqrstuvwx';
            expect(scrubText(`enqueued deletion for ${sub}`)).toBe(`enqueued deletion for ${pseudonymizeId(sub)}`);
        });
    });

    describe('scrubLog', () => {
        it('drops debug logs and pseudonymizes id attributes', () => {
            expect(scrubLog({ level: 'debug', message: 'x' })).toBeNull();
            const out = scrubLog({
                level: 'info',
                message: 'user a@b.com synced',
                attributes: { identityId: 'user_2abcDEFghiJKLmnopqrstuvwx', token: 'x' },
            });
            expect(out?.message).toBe('user [redacted] synced');
            expect(out?.attributes?.['identityId']).toBe(pseudonymizeId('user_2abcDEFghiJKLmnopqrstuvwx'));
            expect(out?.attributes?.['token']).toBe('[redacted]');
        });
    });
});
