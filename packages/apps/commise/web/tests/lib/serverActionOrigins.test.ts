import { describe, expect, it } from 'vitest';

import { SANDBOX_PREVIEW_DOMAIN, derivePreviewAllowedOrigins } from '../../src/lib/serverActionOrigins';

describe('derivePreviewAllowedOrigins', () => {
    it('returns undefined in production (no PR context) so the prod config carries no allowlist', () => {
        expect(derivePreviewAllowedOrigins({})).toBeUndefined();
    });

    it('returns undefined when a mode is set but there is no PR id (nothing to scope the host to)', () => {
        expect(derivePreviewAllowedOrigins({ SANDBOX_PREVIEW_MODE: 'subdomain' })).toBeUndefined();
    });

    it('allows this PR-s own subdomain origin in subdomain mode', () => {
        expect(
            derivePreviewAllowedOrigins({ SANDBOX_PREVIEW_MODE: 'subdomain', VERCEL_GIT_PULL_REQUEST_ID: '73' }),
        ).toEqual(['pr-73.sandbox.commise.app']);
    });

    it('allows the shared apex origin in path mode (the pre-cutover / rollback posture)', () => {
        expect(derivePreviewAllowedOrigins({ SANDBOX_PREVIEW_MODE: 'path', VERCEL_GIT_PULL_REQUEST_ID: '73' })).toEqual(
            ['sandbox.commise.app'],
        );
    });

    it('treats an unset mode as path mode (matches derivePreviewBasePath-s fail-safe default)', () => {
        expect(derivePreviewAllowedOrigins({ VERCEL_GIT_PULL_REQUEST_ID: '73' })).toEqual(['sandbox.commise.app']);
    });

    it('treats a mistyped mode as path mode (fail-safe, never a wildcard)', () => {
        expect(
            derivePreviewAllowedOrigins({ SANDBOX_PREVIEW_MODE: 'subdomainn', VERCEL_GIT_PULL_REQUEST_ID: '73' }),
        ).toEqual(['sandbox.commise.app']);
    });

    // The value lands in Next-s CSRF allowlist, so a non-numeric PR id must never widen it into a
    // pattern (`*`/`**`) or a foreign host. Next matches `*` as one label and `**` as a suffix.
    it('rejects a non-numeric PR id rather than emitting an unbounded host', () => {
        expect(
            derivePreviewAllowedOrigins({ SANDBOX_PREVIEW_MODE: 'subdomain', VERCEL_GIT_PULL_REQUEST_ID: '*' }),
        ).toBeUndefined();
        expect(
            derivePreviewAllowedOrigins({
                SANDBOX_PREVIEW_MODE: 'subdomain',
                VERCEL_GIT_PULL_REQUEST_ID: '73.evil.example.com',
            }),
        ).toBeUndefined();
        expect(
            derivePreviewAllowedOrigins({ SANDBOX_PREVIEW_MODE: 'subdomain', VERCEL_GIT_PULL_REQUEST_ID: '' }),
        ).toBeUndefined();
    });

    it('never emits a scheme or a path — Next compares bare hosts', () => {
        const [origin] = derivePreviewAllowedOrigins({
            SANDBOX_PREVIEW_MODE: 'subdomain',
            VERCEL_GIT_PULL_REQUEST_ID: '73',
        })!;

        expect(origin).not.toMatch(/[:/]/);
        expect(origin!.endsWith(SANDBOX_PREVIEW_DOMAIN)).toBe(true);
    });
});
