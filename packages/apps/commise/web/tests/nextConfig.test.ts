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

/**
 * `Referrer-Policy` is the ONLY thing that closes the analytics query-string leak on the same-origin
 * beacon — `beforeSend` cannot reach it.
 *
 * `src/lib/analyticsRedaction.ts` strips the query string from the event body, but Vercel's collection
 * endpoint is the RELATIVE, same-origin `/_vercel/insights/*`. Under the browser default
 * `strict-origin-when-cross-origin`, a same-origin request carries the FULL URL — query string included —
 * in `Referer`. So a beacon fired from `/en/discover?query=…&dietaryFlags=…` hands Vercel exactly the
 * values the redaction just removed, in a header no application hook can intercept. The redaction is
 * necessary and NOT sufficient; this header is the other half.
 *
 * `strict-origin` rather than `no-referrer`: it drops path + query everywhere (same-origin included) while
 * still sending the bare origin, so genuine external referrer attribution survives. Nothing in this repo
 * reads `Referer` (verified by grep across the web app and every service), so tightening it breaks nothing.
 */
describe('Referrer-Policy (closes the analytics Referer leak)', () => {
    afterEach(() => {
        vi.resetModules();
    });

    it('sends strict-origin for every route, so no path or query can reach a beacon', async () => {
        // Loaded through the SAME pipeline as the allowlist above, so this asserts the header survives
        // `withSentryConfig`'s wrapping — a header declared on the inner object but dropped by the wrapper
        // would type-check and ship nothing.
        const config = await loadConfig({});
        const headers = await config.headers?.();

        expect(headers, 'next.config must declare a headers() block').toBeDefined();

        const universal = headers?.find((entry) => entry.source === '/:path*');

        expect(universal, 'the policy must apply to every route, not a subset').toBeDefined();
        expect(universal?.headers).toEqual(
            expect.arrayContaining([{ key: 'Referrer-Policy', value: 'strict-origin' }]),
        );
    });

    it('does NOT use a policy that leaks the full URL same-origin', async () => {
        // The regression guard. `strict-origin-when-cross-origin` (the browser DEFAULT) and `same-origin`
        // both send the full URL on a same-origin request — which is exactly the beacon's case, so either
        // value silently reopens the leak while looking like a configured policy.
        const leaky = ['strict-origin-when-cross-origin', 'same-origin', 'unsafe-url', 'no-referrer-when-downgrade'];
        const config = await loadConfig({});
        const headers = await config.headers?.();
        const value = headers
            ?.flatMap((entry) => entry.headers)
            .find((header) => header.key === 'Referrer-Policy')?.value;

        expect(leaky).not.toContain(value);
    });
});
