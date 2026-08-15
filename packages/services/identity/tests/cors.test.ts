/**
 * The CORS origin POLICY — `src/config/cors.ts`.
 *
 * ⚠️ WHAT THIS FILE USED TO ASSERT, AND WHY THAT WAS WORSE THAN NO TEST. The old suite fed
 * `buildCorsOptions(['https://sandbox.commise.app'])` and concluded "deployed stages are origin-pinned".
 * That list is one a deployed non-prod stage NEVER HAS: infra sets `CLERK_AUTHORIZED_PARTIES` only when
 * `stage === 'prod'` (`infra/lib/IdentityServiceStack.ts`), non-prod gets `CLERK_AZP_PATTERN`, and
 * `env.schema.ts` enforces exactly one of the two on every deployed stage. So the branch actually taken on
 * sandbox and on every `pr-{N}` was the empty-list one — `origin: true`, reflect ANY origin — and the suite
 * proved a posture the service never ran.
 *
 * The cases below are therefore written from the STAGE's configuration, not from a hand-picked list, so the
 * inputs are the ones the process really sees. `describe` blocks name the stage shape they model.
 *
 * @module
 */
import { describe, it, expect } from 'vitest';

import { buildCorsPolicy, type CorsPolicyInput } from '../src/config/cors.js';

/** The prod shape: an exact-match party list, no pattern (a pattern is rejected on prod by `env.schema.ts`). */
const prodInput: CorsPolicyInput = {
    stage: 'prod',
    authorizedPartiesRaw: 'https://commise.app, https://www.commise.app',
    previewBaseDomain: undefined,
    previewMode: undefined,
};

/** The sandbox / `pr-{N}` shape: NO list, a preview base domain. This is what infra really injects. */
const sandboxInput: CorsPolicyInput = {
    stage: 'sandbox',
    authorizedPartiesRaw: undefined,
    previewBaseDomain: 'sandbox.commise.app',
    previewMode: undefined,
};

/** Does this policy admit `origin`? Applies the same matching rule the `cors` middleware applies. */
function admits(policy: ReturnType<typeof buildCorsPolicy>, origin: string): boolean {
    return policy.options.origin.some((entry) => (typeof entry === 'string' ? entry === origin : entry.test(origin)));
}

describe('buildCorsPolicy', () => {
    describe("the 'prod' shape — an exact-match party list", () => {
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
    });

    describe('a deployed stage with NEITHER selector — fails CLOSED', () => {
        const brokenInput: CorsPolicyInput = {
            stage: 'sandbox',
            authorizedPartiesRaw: undefined,
            previewBaseDomain: undefined,
            previewMode: undefined,
        };

        it('admits nothing at all', () => {
            const policy = buildCorsPolicy(brokenInput);

            expect(policy.mode).toBe('closed');
            expect(admits(policy, 'https://commise.app')).toBe(false);
        });

        // ⚠️ THE REPRESENTATION IS LOAD-BEARING, NOT COSMETIC — but NOT for the reason previously written
        // here. This comment claimed `origin: false` makes `cors@2.8.6` answer `Access-Control-Allow-Origin: *`
        // ("the OPPOSITE of closed"); that is false, and was measured to be false. `configureOrigin`'s `*`
        // branch is unreachable for a falsy option, because `middlewareWrapper` short-circuits to `next()`
        // before `cors()` ever runs. `false` therefore emits NO header — it is a silent middleware BYPASS, not
        // a wildcard. An empty list keeps the middleware in the path and denies by failing the match, which is
        // why the representation still matters. See `src/config/cors.ts` for the measured table, and
        // `tests/corsHeaders.test.ts`, which anchors the guard on the observable difference over real HTTP
        // (`Vary: Origin` + a `204` preflight) rather than on the header absence both values share.
        it('expresses "closed" as an EMPTY LIST, keeping the middleware in the request path', () => {
            expect(buildCorsPolicy(brokenInput).options.origin).toEqual([]);
        });
    });

    describe('a NON-deployed stage (dev/test/local) — loopback only, by choice', () => {
        const devInput: CorsPolicyInput = {
            stage: 'dev',
            authorizedPartiesRaw: undefined,
            previewBaseDomain: undefined,
            previewMode: undefined,
        };

        it.each([
            'http://localhost:3000',
            'http://127.0.0.1:3000',
            'http://localhost:8081',
            'https://localhost:3000',
            'http://[::1]:3000',
            'http://localhost',
        ])('admits the loopback origin %s', (origin) => {
            expect(admits(buildCorsPolicy(devInput), origin)).toBe(true);
        });

        it.each([
            'https://commise.app',
            'http://localhost.evil.example',
            'http://localhostx:3000',
            'http://127.0.0.1.evil.example',
            'http://evil.example#http://localhost:3000',
        ])('refuses the non-loopback origin %s', (origin) => {
            expect(admits(buildCorsPolicy(devInput), origin)).toBe(false);
        });

        it('reports the loopback mode', () => {
            expect(buildCorsPolicy(devInput).mode).toBe('loopback');
        });

        it('still prefers an explicit list when one is set (the e2e harness sets one)', () => {
            const policy = buildCorsPolicy({ ...devInput, authorizedPartiesRaw: 'http://localhost:3000' });

            expect(policy.mode).toBe('exact-list');
            expect(policy.options.origin).toEqual(['http://localhost:3000']);
        });
    });

    describe('invariants that hold for every stage', () => {
        const everyShape: readonly CorsPolicyInput[] = [
            prodInput,
            sandboxInput,
            { ...sandboxInput, previewMode: 'transition' },
            { stage: 'dev', authorizedPartiesRaw: undefined, previewBaseDomain: undefined, previewMode: undefined },
            { stage: 'pr-73', authorizedPartiesRaw: undefined, previewBaseDomain: undefined, previewMode: undefined },
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

        it('always allows the distributed-tracing + auth headers through preflight', () => {
            for (const input of everyShape) {
                expect(buildCorsPolicy(input).options.allowedHeaders).toEqual(
                    expect.arrayContaining(['Content-Type', 'Authorization', 'sentry-trace', 'baggage']),
                );
            }
        });
    });
});
