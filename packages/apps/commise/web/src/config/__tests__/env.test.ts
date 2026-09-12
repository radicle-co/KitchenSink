// @vitest-environment node
/**
 * The web app's endpoint configuration must come from the environment and have NO in-code fallback.
 *
 * ## Why this test exists
 *
 * The two API base URLs used to be read inline with a default:
 *
 *     process.env['NEXT_PUBLIC_API_URL']      ?? 'http://localhost:3000'   // recipe
 *     process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:4000'   // identity
 *
 * `NEXT_PUBLIC_*` is inlined by the bundler at BUILD time, so when the Vercel preview build ran without
 * those variables set, the fallback was baked into the shipped bundle. Every signed-in visitor's browser
 * then called `http://localhost:3000` — their OWN machine — and every data surface on the deployed app
 * failed with ERR_CONNECTION_REFUSED. A silent, plausible default turned a missing-configuration error
 * into a runtime mystery, and nothing in the test suite could see it because the fallback made the code
 * "work" everywhere a test ran.
 *
 * The fix is to make configuration absent-by-default and LOUD: the schema below has no defaults, so a
 * build that was not given its endpoints fails at build time instead of shipping a broken bundle. Local
 * development still gets localhost for free — not from code, but from the committed `.env.development`,
 * which Next loads only when `NODE_ENV=development` (i.e. `next dev`) and never during `next build`.
 *
 * These tests re-import the module under `vi.resetModules()` because validation happens once, at module
 * load — which is the whole point: the failure surfaces at startup/build, not at first fetch.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const RECIPE = 'NEXT_PUBLIC_RECIPE_API_URL';
const IDENTITY = 'NEXT_PUBLIC_IDENTITY_API_URL';

/** Load a fresh copy of the config module under the given environment. */
async function loadEnv(vars: Readonly<Record<string, string | undefined>>): Promise<{ env: Record<string, string> }> {
    vi.resetModules();

    for (const [key, value] of Object.entries(vars)) {
        if (value === undefined) {
            vi.stubEnv(key, '');
            // `stubEnv('')` sets an empty string; delete it so the variable is genuinely ABSENT, which is
            // what an unconfigured build actually looks like.
            delete process.env[key];
        } else {
            vi.stubEnv(key, value);
        }
    }

    return (await import('../env.js')) as unknown as { env: Record<string, string> };
}

afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
});

describe('web endpoint configuration', () => {
    it('exposes the endpoints the environment supplies', async () => {
        const { env } = await loadEnv({
            [RECIPE]: 'https://recipe-pr-73.commise.app',
            [IDENTITY]: 'https://identity.sandbox.commise.app',
            // Required since the 2026-08-07 outage, and must be stage-COHERENT with the endpoints above:
            // these are sandbox/per-PR hosts, so a development instance is the correct pairing.
            NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_bmljZS1mb3dsLTYuY2xlcmsuYWNjb3VudHMuZGV2JA',
        });

        expect(env[RECIPE]).toBe('https://recipe-pr-73.commise.app');
        expect(env[IDENTITY]).toBe('https://identity.sandbox.commise.app');
    });

    it('refuses to start when an endpoint is missing, instead of defaulting to localhost', async () => {
        // The regression that shipped. A default here is not a convenience — it is a deployed outage that
        // looks like working code, so absence MUST be fatal.
        await expect(
            loadEnv({ [RECIPE]: undefined, [IDENTITY]: 'https://identity.sandbox.commise.app' }),
        ).rejects.toThrow(/invalid environment variables[\s\S]*NEXT_PUBLIC_RECIPE_API_URL/i);
    });

    it('treats an empty value as missing (an unset CI/dashboard variable is often "")', async () => {
        // A blank dashboard field is the most common way this is misconfigured, and `''` would otherwise
        // pass a bare string check and produce requests against the page's own origin.
        await expect(loadEnv({ [RECIPE]: '', [IDENTITY]: 'https://identity.sandbox.commise.app' })).rejects.toThrow(
            /invalid environment variables[\s\S]*NEXT_PUBLIC_RECIPE_API_URL/i,
        );
    });

    it('rejects a value that is not an absolute URL', async () => {
        // `/api` or `recipe.commise.app` would resolve relative to the page and fail only in the browser.
        await expect(
            loadEnv({ [RECIPE]: 'recipe.commise.app', [IDENTITY]: 'https://identity.sandbox.commise.app' }),
        ).rejects.toThrow(/invalid environment variables[\s\S]*NEXT_PUBLIC_RECIPE_API_URL/i);
    });

    it('never yields a localhost endpoint unless the environment explicitly asked for one', async () => {
        // Guards the specific failure mode: the value must be traceable to the environment, so a reader
        // can always answer "where did this URL come from?" with "whoever built it set it".
        // Hosts are sandbox ones rather than example.com because `env.ts` now also asserts stage
        // COHERENCE between the Clerk instance and the endpoints, and an unclassifiable host is a
        // deliberate hard failure there — an unrecognised host is exactly where the next variant of the
        // 2026-08-07 mismatch would hide. The point of THIS test is unchanged: the value must be
        // traceable to the environment, never defaulted to localhost.
        const { env } = await loadEnv({
            [RECIPE]: 'https://recipe-pr-99.commise.app',
            [IDENTITY]: 'https://identity.sandbox.commise.app',
            NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_bmljZS1mb3dsLTYuY2xlcmsuYWNjb3VudHMuZGV2JA',
        });

        expect(env[RECIPE]).not.toMatch(/localhost/);
        expect(env[IDENTITY]).not.toMatch(/localhost/);
    });
});

describe('stage-coherence coverage is DERIVED, not hand-maintained', () => {
    /**
     * The coherence check that now fails the build on a stage mismatch is only as good as the set of
     * endpoints handed to it. When that set was a hand-written literal, adding a new endpoint to the schema
     * and forgetting to add it to the check produced a variable that was shape-validated but stage-UNCHECKED
     * — silently outside the guard.
     *
     * That is not hypothetical. Feature 005 (AI integration, unmerged) adds `NEXT_PUBLIC_AI_API_URL`, and its
     * Vercel records are scoped to preview AND production at once — the same shape as the misconfiguration
     * that took production down. It would arrive shape-valid and stage-unchecked.
     *
     * So the guard's input is derived from the schema instead: every `NEXT_PUBLIC_*_API_URL` the module
     * declares is checked, automatically. This test pins that property rather than the current list, so it
     * keeps holding for endpoints that do not exist yet.
     */
    it('checks EVERY declared *_API_URL endpoint, not a hand-listed subset', async () => {
        const { STAGE_CHECKED_ENDPOINT_KEYS } = await import('../env.js');
        const { env } = await import('../env.js');

        const declaredEndpointKeys = Object.keys(env).filter((key) => /^NEXT_PUBLIC_[A-Z0-9_]+_API_URL$/.test(key));

        expect(declaredEndpointKeys.length).toBeGreaterThan(0);
        expect([...STAGE_CHECKED_ENDPOINT_KEYS].sort()).toEqual(declaredEndpointKeys.sort());
    });

    it('would REJECT a future endpoint that disagrees with the Clerk instance', async () => {
        // The mutation this file exists to catch: a new endpoint added to the schema but not to the guard.
        // Simulated at the guard's own boundary, since the schema cannot gain a key at runtime.
        const { findStageIncoherence } = await import('../clerkStageCoherence.js');

        const problems = findStageIncoherence({
            clerkPublishableKey: 'pk_test_bmljZS1mb3dsLTYuY2xlcmsuYWNjb3VudHMuZGV2JA',
            endpoints: { NEXT_PUBLIC_AI_API_URL: 'https://ai.commise.app' },
        });

        expect(problems).not.toEqual([]);
        expect(problems.join(' ')).toContain('NEXT_PUBLIC_AI_API_URL');
    });
});
