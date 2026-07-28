import type { NextConfig } from 'next';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The Server-Action CSRF allowlist only protects previews if it survives the whole config pipeline —
// derivation, spread into `experimental`, and `withSentryConfig`'s wrapping. The pure derivation is
// covered in lib/serverActionOrigins.test.ts; this asserts the WIRING, which is where a config that
// type-checks can still ship an empty allowlist. See ADR-0001.
async function loadConfig(env: Record<string, string | undefined>): Promise<NextConfig> {
    vi.resetModules();

    for (const [key, value] of Object.entries(env)) {
        if (value === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = value;
        }
    }

    const mod = (await import('../next.config')) as { default: NextConfig };

    return mod.default;
}

const PREVIEW_ENV_KEYS = ['SANDBOX_PREVIEW_MODE', 'VERCEL_GIT_PULL_REQUEST_ID', 'PREVIEW_BASE_PATH'] as const;

describe('next.config — Server Action allowed origins', () => {
    afterEach(() => {
        for (const key of PREVIEW_ENV_KEYS) {
            delete process.env[key];
        }

        vi.resetModules();
    });

    it('allows this PR-s public preview origin in subdomain mode', async () => {
        const config = await loadConfig({ SANDBOX_PREVIEW_MODE: 'subdomain', VERCEL_GIT_PULL_REQUEST_ID: '73' });

        expect(config.experimental?.serverActions?.allowedOrigins).toEqual(['pr-73.sandbox.commise.app']);
    });

    it('allows the shared apex origin in the path-routed rollback posture', async () => {
        const config = await loadConfig({ SANDBOX_PREVIEW_MODE: 'path', VERCEL_GIT_PULL_REQUEST_ID: '73' });

        expect(config.experimental?.serverActions?.allowedOrigins).toEqual(['sandbox.commise.app']);
    });

    it('ships NO allowlist in production, so prod keeps Next-s strict same-origin check', async () => {
        const config = await loadConfig({
            SANDBOX_PREVIEW_MODE: undefined,
            VERCEL_GIT_PULL_REQUEST_ID: undefined,
            PREVIEW_BASE_PATH: undefined,
        });

        expect(config.experimental?.serverActions).toBeUndefined();
    });
});
