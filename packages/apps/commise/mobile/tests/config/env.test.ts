/**
 * The mobile app's endpoint configuration must come from the environment and have NO in-code fallback —
 * the native mirror of `web/src/config/__tests__/env.test.ts` (FR-044 platform parity: both hosts resolve
 * their backends the same way, so they must fail the same way too).
 *
 * ## Why this matters at least as much on native as on web
 *
 * `EXPO_PUBLIC_*` is inlined by Babel at BUILD time exactly like `NEXT_PUBLIC_*`, so a fallback is frozen
 * into the shipped binary. The two defaults that used to live here were worse than web's:
 *
 *     process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000'                     // recipe
 *     EXPO_PUBLIC_IDENTITY_API_URL ?? EXPO_PUBLIC_API_URL ?? 'https://api.commise.io' // identity
 *
 * `http://localhost:3000` on a phone is the PHONE — not the developer's machine — so every request fails
 * with no route to host. And `https://api.commise.io` is a hardcoded guess at a production hostname that
 * nothing in this repo provisions; shipping it means a build silently addresses a domain the team does not
 * control. Neither is a safe thing to guess, so absence must be fatal instead.
 *
 * The identity chain also silently fell back to the RECIPE origin, which sends `/v1/users/me` to a service
 * that does not serve it — a 404 that looks like a bug in the profile screen rather than a missing setting.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const RECIPE = 'EXPO_PUBLIC_RECIPE_API_URL';
const IDENTITY = 'EXPO_PUBLIC_IDENTITY_API_URL';

/** Load a fresh copy of the config module under the given environment. */
async function loadEnv(vars: Readonly<Record<string, string | undefined>>): Promise<{ env: Record<string, string> }> {
    vi.resetModules();

    for (const [key, value] of Object.entries(vars)) {
        if (value === undefined) {
            vi.stubEnv(key, '');
            delete process.env[key];
        } else {
            vi.stubEnv(key, value);
        }
    }

    return (await import('../../src/config/env.js')) as unknown as { env: Record<string, string> };
}

afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
});

describe('mobile endpoint configuration', () => {
    it('exposes the endpoints the environment supplies', async () => {
        const { env } = await loadEnv({
            [RECIPE]: 'https://recipe-pr-73.commise.app',
            [IDENTITY]: 'https://identity.sandbox.commise.app',
        });

        expect(env[RECIPE]).toBe('https://recipe-pr-73.commise.app');
        expect(env[IDENTITY]).toBe('https://identity.sandbox.commise.app');
    });

    it('refuses to start when the recipe endpoint is missing', async () => {
        await expect(
            loadEnv({ [RECIPE]: undefined, [IDENTITY]: 'https://identity.sandbox.commise.app' }),
        ).rejects.toThrow(/invalid environment variables[\s\S]*EXPO_PUBLIC_RECIPE_API_URL/i);
    });

    it('refuses to start when the identity endpoint is missing, rather than reusing the recipe origin', async () => {
        // The old chain fell through to the recipe origin, so `/v1/users/me` went to a service that does
        // not serve it. A 404 on the profile screen is a much worse signal than a refusal to boot.
        await expect(loadEnv({ [RECIPE]: 'https://recipe-pr-73.commise.app', [IDENTITY]: undefined })).rejects.toThrow(
            /invalid environment variables[\s\S]*EXPO_PUBLIC_IDENTITY_API_URL/i,
        );
    });

    it('treats an empty value as missing', async () => {
        await expect(loadEnv({ [RECIPE]: '', [IDENTITY]: 'https://identity.sandbox.commise.app' })).rejects.toThrow(
            /invalid environment variables[\s\S]*EXPO_PUBLIC_RECIPE_API_URL/i,
        );
    });

    it('rejects a value that is not an absolute URL', async () => {
        await expect(
            loadEnv({ [RECIPE]: 'recipe.commise.app', [IDENTITY]: 'https://identity.sandbox.commise.app' }),
        ).rejects.toThrow(/invalid environment variables[\s\S]*EXPO_PUBLIC_RECIPE_API_URL/i);
    });

    it('never invents a production hostname the repo does not provision', async () => {
        const { env } = await loadEnv({
            [RECIPE]: 'https://recipe.example.com',
            [IDENTITY]: 'https://identity.example.com',
        });

        expect(env[IDENTITY]).not.toMatch(/api\.commise\.io/);
        expect(env[RECIPE]).not.toMatch(/api\.commise\.io/);
    });
});
