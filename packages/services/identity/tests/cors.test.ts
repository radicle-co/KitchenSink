/**
 * The identity service's CORS ADAPTER, `src/config/cors.ts`: that `STAGE` decides `deployed`, and that the Clerk
 * configuration reaches the shared policy unchanged.
 *
 * The policy's own cases (which origins each shape admits and refuses) are asserted once, in
 * `@kitchensink/clerk-verify`'s `corsPolicy.test.ts`. The emitted headers are asserted in `corsHeaders.test.ts`.
 *
 * @module
 */
import { describe, it, expect } from 'vitest';

import { buildCorsPolicy, type CorsPolicyInput } from '../src/config/cors.js';

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

describe('buildCorsPolicy', () => {
    it.each(['dev', 'test', 'local'])('gives the non-deployed stage %s the loopback origins', (stage) => {
        const policy = buildCorsPolicy({ ...unconfigured, stage });

        expect(policy.mode).toBe('loopback');
        expect(admits(policy, 'http://localhost:3000')).toBe(true);
    });

    it.each(['prod', 'sandbox', 'pr-73'])('fails CLOSED for the deployed stage %s with nothing configured', (stage) => {
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
        const sandbox = { ...unconfigured, stage: 'sandbox', previewBaseDomain: 'sandbox.commise.app' };
        const strict = buildCorsPolicy(sandbox);
        const transition = buildCorsPolicy({ ...sandbox, previewMode: 'transition' });

        expect(strict.mode).toBe('preview-pattern');
        expect(admits(strict, 'https://pr-73.sandbox.commise.app')).toBe(true);
        expect(admits(strict, 'https://sandbox.commise.app')).toBe(false);
        // Only `transition` admits the apex, so this reds if the adapter drops `previewMode`.
        expect(admits(transition, 'https://sandbox.commise.app')).toBe(true);
    });
});
