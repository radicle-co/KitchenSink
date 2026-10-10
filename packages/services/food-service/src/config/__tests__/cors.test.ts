/**
 * The food service's CORS ADAPTER, `src/config/cors.ts`: that `STAGE` decides `deployed`, and that the Clerk
 * configuration reaches the shared policy unchanged (plan 002 S4, ADR-0047).
 *
 * The policy's own cases (which origins each shape admits and refuses) are asserted once, in `@kitchensink/clerk-verify`'s
 * `corsPolicy.test.ts`. The headers food actually sends, on its real routes behind `FoodAuthGuard`, are asserted by
 * `tests/foodCors.integration.test.ts`, and the call in `main.ts` by `corsWiring.test.ts`.
 *
 * @module
 */
import { afterEach, describe, expect, it } from 'vitest';

import { buildCorsPolicy, corsPolicyFromEnv, type CorsPolicyInput } from '../cors.js';
import { isDeployedStage } from '../env.schema.js';

/** Nothing Clerk-related configured, so the `deployed` decision alone picks the mode. */
const unconfigured: Omit<CorsPolicyInput, 'stage'> = {
    authorizedPartiesRaw: undefined,
    previewBaseDomain: undefined,
    previewMode: undefined,
};

/** Does this policy admit `origin`? Applies the same matching rule the `cors` middleware applies. */
function admits(policy: ReturnType<typeof buildCorsPolicy>, origin: string): boolean {
    return policy.options.origin.some((entry) => (typeof entry === 'string' ? entry === origin : entry.test(origin)));
}

describe('isDeployedStage', () => {
    it.each(['dev', 'test', 'local'])('treats the local sentinel %s as a developer machine', (stage) => {
        expect(isDeployedStage(stage)).toBe(false);
    });

    // The fail-closed direction: a stage this module does not recognise must not buy the permissive branch.
    it.each(['prod', 'sandbox', 'pr-91', 'staging', '', 'Dev', 'dev ', 'development'])(
        'treats %o as deployed',
        (stage) => {
            expect(isDeployedStage(stage)).toBe(true);
        },
    );
});

describe('buildCorsPolicy', () => {
    it('gives a developer machine with nothing configured the loopback origins', () => {
        const policy = buildCorsPolicy({ ...unconfigured, stage: 'dev' });

        expect(policy.mode).toBe('loopback');
        expect(admits(policy, 'http://localhost:3000')).toBe(true);
        expect(admits(policy, 'https://commise.app')).toBe(false);
    });

    it.each(['prod', 'sandbox', 'pr-91'])('fails CLOSED on the deployed stage %s with nothing configured', (stage) => {
        const policy = buildCorsPolicy({ ...unconfigured, stage });

        expect(policy.mode).toBe('closed');
        expect(policy.options.origin).toEqual([]);
    });

    it('hands an explicit party list through (the prod shape)', () => {
        const policy = buildCorsPolicy({
            ...unconfigured,
            stage: 'prod',
            authorizedPartiesRaw: 'https://commise.app, https://www.commise.app',
        });

        expect(policy.mode).toBe('exact-list');
        expect(policy.options.origin).toEqual(['https://commise.app', 'https://www.commise.app']);
    });

    it('hands the preview base domain and the preview mode through (the sandbox shape)', () => {
        const sandbox = { ...unconfigured, stage: 'pr-91', previewBaseDomain: 'sandbox.commise.app' };
        const strict = buildCorsPolicy(sandbox);
        const transition = buildCorsPolicy({ ...sandbox, previewMode: 'transition' });

        expect(strict.mode).toBe('preview-pattern');
        expect(admits(strict, 'https://pr-91.sandbox.commise.app')).toBe(true);
        expect(admits(strict, 'https://sandbox.commise.app')).toBe(false);
        // Only `transition` admits the apex, so this reds if the adapter drops `previewMode`.
        expect(admits(transition, 'https://sandbox.commise.app')).toBe(true);
    });
});

describe('corsPolicyFromEnv — the one reader main.ts and the integration harness share', () => {
    const KEYS = ['STAGE', 'CLERK_AUTHORIZED_PARTIES', 'CLERK_AZP_PATTERN', 'CLERK_AZP_PREVIEW_MODE'] as const;
    const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));

    afterEach(() => {
        for (const key of KEYS) {
            const value = saved[key];

            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    });

    /** Set exactly the given variables, clearing the rest of the four. */
    function environment(values: Partial<Record<(typeof KEYS)[number], string>>): void {
        for (const key of KEYS) {
            const value = values[key];

            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    }

    it('reads the azp variables FoodAuthGuard reads, so the two boundaries cannot differ (the prod shape)', () => {
        environment({ STAGE: 'prod', CLERK_AUTHORIZED_PARTIES: 'https://commise.app' });

        expect(corsPolicyFromEnv().options.origin).toEqual(['https://commise.app']);
    });

    it('reads the preview pattern and the preview mode (the sandbox shape)', () => {
        environment({ STAGE: 'pr-91', CLERK_AZP_PATTERN: 'sandbox.commise.app', CLERK_AZP_PREVIEW_MODE: 'transition' });

        const policy = corsPolicyFromEnv();

        expect(policy.mode).toBe('preview-pattern');
        expect(admits(policy, 'https://sandbox.commise.app')).toBe(true);
    });

    it("takes STAGE through the config schema, whose default is the local sentinel 'dev'", () => {
        environment({});

        expect(corsPolicyFromEnv().mode).toBe('loopback');
    });

    it('fails CLOSED on a deployed STAGE with nothing configured', () => {
        environment({ STAGE: 'sandbox' });

        expect(corsPolicyFromEnv().mode).toBe('closed');
    });
});
