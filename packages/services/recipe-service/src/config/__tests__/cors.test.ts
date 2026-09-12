/**
 * The CORS origin POLICY — `src/config/cors.ts`.
 *
 * ⚠️ WHAT THIS FILE USED TO ASSERT, AND WHY THAT WAS WORSE THAN NO TEST. The old suite fed
 * `buildCorsOptions(['https://commise.app', ...])` and concluded "deployed stages are origin-pinned", then
 * asserted `buildCorsOptions([]).origin === true` as if reflecting any origin were the intended local
 * behaviour. That empty list is not a local-only case: `infra/lib/RecipeServiceStack.ts` sets
 * `CLERK_AUTHORIZED_PARTIES` only on prod, non-prod gets `CLERK_AZP_PATTERN`, and `config.types.ts` enforces
 * exactly one of the two — so the branch actually taken on sandbox and on every `pr-{N}` was the empty-list
 * one, and the suite PINNED the any-origin reflector as correct.
 *
 * The cases below are therefore written from the ENVIRONMENT's configuration, not from a hand-picked list, so
 * the inputs are the ones the process really sees. `describe` blocks name the shape they model. The emitted
 * headers — including the two representations of "closed" that this file cannot tell apart — are asserted in
 * `corsHeaders.test.ts`.
 *
 * @module
 */
import { describe, it, expect } from 'vitest';

import { buildCorsPolicy, isDeployedEnvironment, type CorsPolicyInput } from '../cors.js';

/** The prod shape: an exact-match party list, no pattern (a pattern is rejected in prod by `config.types.ts`). */
const prodInput: CorsPolicyInput = {
    nodeEnv: 'production',
    authorizedPartiesRaw: 'https://commise.app, https://www.commise.app',
    previewBaseDomain: undefined,
    previewMode: undefined,
};

/** The sandbox / `pr-{N}` shape: NO list, a preview base domain. This is what infra really injects. */
const sandboxInput: CorsPolicyInput = {
    nodeEnv: 'staging',
    authorizedPartiesRaw: undefined,
    previewBaseDomain: 'sandbox.commise.app',
    previewMode: undefined,
};

/** The developer-machine shape: nothing Clerk-related configured at all. */
const localInput: CorsPolicyInput = {
    nodeEnv: 'development',
    authorizedPartiesRaw: undefined,
    previewBaseDomain: undefined,
    previewMode: undefined,
};

/** Does this policy admit `origin`? Applies the same matching rule the `cors` middleware applies. */
function admits(policy: ReturnType<typeof buildCorsPolicy>, origin: string): boolean {
    return policy.options.origin.some((entry) => (typeof entry === 'string' ? entry === origin : entry.test(origin)));
}

describe('isDeployedEnvironment', () => {
    it.each(['production', 'staging'])('treats %s as deployed', (nodeEnv) => {
        expect(isDeployedEnvironment(nodeEnv)).toBe(true);
    });

    it('treats exactly `development` as a developer machine', () => {
        expect(isDeployedEnvironment('development')).toBe(false);
    });

    // The fail-closed direction: an absent or unrecognized NODE_ENV must not buy the permissive branch.
    it.each([undefined, '', 'dev', 'Development', 'development ', 'test'])(
        'treats the unrecognized value %o as deployed',
        (nodeEnv) => {
            expect(isDeployedEnvironment(nodeEnv)).toBe(true);
        },
    );
});

describe('buildCorsPolicy', () => {
    describe('the prod shape — an exact-match party list', () => {
        it('pins the explicit list and reports the exact-list mode', () => {
            const policy = buildCorsPolicy(prodInput);

            expect(policy.mode).toBe('exact-list');
            expect(policy.options.origin).toEqual(['https://commise.app', 'https://www.commise.app']);
        });

        it('admits a listed origin and refuses an unlisted one', () => {
            const policy = buildCorsPolicy(prodInput);

            expect(admits(policy, 'https://commise.app')).toBe(true);
            expect(admits(policy, 'https://evil.example')).toBe(false);
        });

        it('refuses a preview subdomain — prod is exact-match only (ADR-0001)', () => {
            expect(admits(buildCorsPolicy(prodInput), 'https://pr-73.sandbox.commise.app')).toBe(false);
        });
    });

    describe("the deployed non-prod shape — the anchored CLERK_AZP_PATTERN, NOT 'reflect anything'", () => {
        it('derives the origin matcher from the azp pattern and reports the preview-pattern mode', () => {
            const policy = buildCorsPolicy(sandboxInput);

            expect(policy.mode).toBe('preview-pattern');
            expect(admits(policy, 'https://pr-73.sandbox.commise.app')).toBe(true);
        });

        // THE REGRESSION THIS FILE EXISTS FOR. `origin: true` admitted every one of these.
        it.each([
            'https://evil.example',
            'http://pr-73.sandbox.commise.app',
            'https://pr-73.sandbox.commise.app.evil.example',
            'https://evil.example/?x=https://pr-73.sandbox.commise.app',
            'https://pr-.sandbox.commise.app',
            'https://prod.sandbox.commise.app',
        ])('refuses %s', (origin) => {
            expect(admits(buildCorsPolicy(sandboxInput), origin)).toBe(false);
        });

        it('refuses the path-routed apex origin under the default (strict) preview mode', () => {
            expect(admits(buildCorsPolicy(sandboxInput), 'https://sandbox.commise.app')).toBe(false);
        });

        it("admits the apex origin ONLY under previewMode 'transition' (the ADR-0001 cutover window)", () => {
            const policy = buildCorsPolicy({ ...sandboxInput, previewMode: 'transition' });

            expect(admits(policy, 'https://sandbox.commise.app')).toBe(true);
            expect(admits(policy, 'https://pr-73.sandbox.commise.app')).toBe(true);
            expect(admits(policy, 'https://evil.example')).toBe(false);
        });

        it('treats any other previewMode value as strict — a typo must not widen the boundary', () => {
            const policy = buildCorsPolicy({ ...sandboxInput, previewMode: 'transitions' });

            expect(admits(policy, 'https://sandbox.commise.app')).toBe(false);
        });

        // Defence in depth for a configuration `config.types.ts` REJECTS at boot (exactly one azp mode). If
        // both selectors somehow arrive, the NARROWER one must win: a list admits N origins, a pattern admits a
        // family of them. Pinning the precedence is also what makes the branch order here a decision rather
        // than an accident.
        it('prefers the exact list over the pattern when both are somehow set', () => {
            const policy = buildCorsPolicy({ ...sandboxInput, authorizedPartiesRaw: 'https://commise.app' });

            expect(policy.mode).toBe('exact-list');
            expect(admits(policy, 'https://commise.app')).toBe(true);
            expect(admits(policy, 'https://pr-73.sandbox.commise.app')).toBe(false);
        });
    });

    describe('a deployed environment with NEITHER selector — fails CLOSED', () => {
        const brokenInput: CorsPolicyInput = {
            nodeEnv: 'production',
            authorizedPartiesRaw: undefined,
            previewBaseDomain: undefined,
            previewMode: undefined,
        };

        it('admits nothing at all', () => {
            const policy = buildCorsPolicy(brokenInput);

            expect(policy.mode).toBe('closed');
            expect(admits(policy, 'https://commise.app')).toBe(false);
        });

        // ⚠️ THE REPRESENTATION IS LOAD-BEARING, NOT COSMETIC — but not for the reason folklore gives. `false`
        // does NOT emit `*` (`cors`'s `middlewareWrapper` short-circuits before `configureOrigin` can); it
        // removes the CORS middleware from the request path, so the denial stops being this policy's decision.
        // `corsHeaders.test.ts` proves that distinction over real HTTP; here the shape is simply pinned.
        it('expresses "closed" as an EMPTY LIST, never a boolean', () => {
            expect(buildCorsPolicy(brokenInput).options.origin).toEqual([]);
        });

        it('is reached for a staging environment too, not just production', () => {
            expect(buildCorsPolicy({ ...brokenInput, nodeEnv: 'staging' }).mode).toBe('closed');
        });
    });

    describe('a developer machine (NODE_ENV=development) — loopback only, by choice', () => {
        it.each([
            'http://localhost:3000',
            'http://127.0.0.1:3000',
            'http://localhost:8081',
            'https://localhost:3000',
            'http://[::1]:3000',
            'http://localhost',
        ])('admits the loopback origin %s', (origin) => {
            expect(admits(buildCorsPolicy(localInput), origin)).toBe(true);
        });

        it.each([
            'https://commise.app',
            'http://localhost.evil.example',
            'http://localhostx:3000',
            'http://127.0.0.1.evil.example',
            'http://evil.example#http://localhost:3000',
            'https://evil.example/http://localhost:3000',
        ])('refuses the non-loopback origin %s', (origin) => {
            expect(admits(buildCorsPolicy(localInput), origin)).toBe(false);
        });

        it('reports the loopback mode', () => {
            expect(buildCorsPolicy(localInput).mode).toBe('loopback');
        });

        it('still prefers an explicit list when one is set (the e2e harness sets one)', () => {
            const policy = buildCorsPolicy({ ...localInput, authorizedPartiesRaw: 'http://localhost:3000' });

            expect(policy.mode).toBe('exact-list');
            expect(policy.options.origin).toEqual(['http://localhost:3000']);
        });
    });

    describe('invariants that hold for every environment', () => {
        const everyShape: readonly CorsPolicyInput[] = [
            prodInput,
            sandboxInput,
            { ...sandboxInput, previewMode: 'transition' },
            localInput,
            {
                nodeEnv: 'production',
                authorizedPartiesRaw: undefined,
                previewBaseDomain: undefined,
                previewMode: undefined,
            },
        ];

        // The whole point of the type: `origin` cannot express "reflect whatever you are sent".
        it('never yields a boolean origin — the permissiveness is always an explicit matcher list', () => {
            for (const input of everyShape) {
                const { origin } = buildCorsPolicy(input).options;

                expect(Array.isArray(origin)).toBe(true);
                expect(origin).not.toBe(true);
            }
        });

        it('always sends credentials, which is what forbids a `*` wildcard', () => {
            for (const input of everyShape) {
                expect(buildCorsPolicy(input).options.credentials).toBe(true);
            }
        });

        it('always allows the auth + content-type + distributed-tracing headers through preflight', () => {
            for (const input of everyShape) {
                expect(buildCorsPolicy(input).options.allowedHeaders).toEqual(
                    expect.arrayContaining(['Content-Type', 'Authorization', 'sentry-trace', 'baggage']),
                );
            }
        });

        it('hands out a fresh header array per call — a caller cannot mutate the shared default', () => {
            const first = buildCorsPolicy(prodInput).options.allowedHeaders;

            first.push('x-injected');

            expect(buildCorsPolicy(prodInput).options.allowedHeaders).not.toContain('x-injected');
        });
    });
});
