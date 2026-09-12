/**
 * The CORS origin policy every browser-facing service shares (plan 002 S1): which origins may call a service, derived
 * from the same Clerk `azp` boundary the token check enforces, and CLOSED when a deployed service has neither selector.
 *
 * Moved here from recipe-service's and identity's `config/cors.ts`, which now only decide `deployed` from their own
 * validated configuration. The emitted headers are asserted at the header level in each service's own tests.
 *
 * | Requirement (plan 002 S4 security review)                                  | Test                                                  |
 * | -------------------------------------------------------------------------- | ----------------------------------------------------- |
 * | F2: a bearer-only service sends no `Access-Control-Allow-Credentials`       | 'sends no credentials unless the adopter asks'        |
 * | F2: an adopter that still needs credentials can ask for them                | 'sends credentials when the adopter asks for them'    |
 * | F3: a browser can read `Retry-After` on a `429` or a `503`                  | 'exposes Retry-After to the browser'                  |
 * | F7: a browser caches a preflight instead of repeating it every few seconds | 'lets the browser cache a preflight for ten minutes'  |
 */
import { describe, expect, it } from 'vitest';

import { resolveCorsPolicy, type CorsPolicyInput } from '../corsPolicy.js';

/** The prod shape: an exact-match party list, no pattern. */
const prodInput: CorsPolicyInput = {
    deployed: true,
    authorizedPartiesRaw: 'https://commise.app, https://www.commise.app',
    previewBaseDomain: undefined,
    previewMode: undefined,
};

/** The sandbox / `pr-{N}` shape: NO list, a preview base domain. */
const sandboxInput: CorsPolicyInput = {
    deployed: true,
    authorizedPartiesRaw: undefined,
    previewBaseDomain: 'sandbox.commise.app',
    previewMode: undefined,
};

/** The developer-machine shape: nothing Clerk-related configured at all. */
const localInput: CorsPolicyInput = {
    deployed: false,
    authorizedPartiesRaw: undefined,
    previewBaseDomain: undefined,
    previewMode: undefined,
};

/** Does this policy admit `origin`? Applies the same matching rule the `cors` middleware applies. */
function admits(policy: ReturnType<typeof resolveCorsPolicy>, origin: string): boolean {
    return policy.options.origin.some((entry) => (typeof entry === 'string' ? entry === origin : entry.test(origin)));
}

describe('resolveCorsPolicy', () => {
    describe('the prod shape — an exact-match party list', () => {
        it('pins the explicit list and reports the exact-list mode', () => {
            const policy = resolveCorsPolicy(prodInput);

            expect(policy.mode).toBe('exact-list');
            expect(policy.options.origin).toEqual(['https://commise.app', 'https://www.commise.app']);
        });

        it('admits a listed origin and refuses an unlisted one', () => {
            const policy = resolveCorsPolicy(prodInput);

            expect(admits(policy, 'https://commise.app')).toBe(true);
            expect(admits(policy, 'https://evil.example')).toBe(false);
        });

        it('refuses a preview subdomain — prod is exact-match only (ADR-0001)', () => {
            expect(admits(resolveCorsPolicy(prodInput), 'https://pr-73.sandbox.commise.app')).toBe(false);
        });
    });

    describe("the deployed non-prod shape — the anchored CLERK_AZP_PATTERN, NOT 'reflect anything'", () => {
        it('derives the origin matcher from the azp pattern and reports the preview-pattern mode', () => {
            const policy = resolveCorsPolicy(sandboxInput);

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
            expect(admits(resolveCorsPolicy(sandboxInput), origin)).toBe(false);
        });

        it('refuses the path-routed apex origin under the default (strict) preview mode', () => {
            expect(admits(resolveCorsPolicy(sandboxInput), 'https://sandbox.commise.app')).toBe(false);
        });

        it("admits the apex origin ONLY under previewMode 'transition' (the ADR-0001 cutover window)", () => {
            const policy = resolveCorsPolicy({ ...sandboxInput, previewMode: 'transition' });

            expect(admits(policy, 'https://sandbox.commise.app')).toBe(true);
            expect(admits(policy, 'https://pr-73.sandbox.commise.app')).toBe(true);
            expect(admits(policy, 'https://evil.example')).toBe(false);
        });

        it('treats any other previewMode value as strict — a typo must not widen the boundary', () => {
            const policy = resolveCorsPolicy({ ...sandboxInput, previewMode: 'transitions' });

            expect(admits(policy, 'https://sandbox.commise.app')).toBe(false);
        });

        // Defence in depth for a configuration `config.types.ts` REJECTS at boot (exactly one azp mode). If
        // both selectors somehow arrive, the NARROWER one must win: a list admits N origins, a pattern admits a
        // family of them. Pinning the precedence is also what makes the branch order here a decision rather
        // than an accident.
        it('prefers the exact list over the pattern when both are somehow set', () => {
            const policy = resolveCorsPolicy({ ...sandboxInput, authorizedPartiesRaw: 'https://commise.app' });

            expect(policy.mode).toBe('exact-list');
            expect(admits(policy, 'https://commise.app')).toBe(true);
            expect(admits(policy, 'https://pr-73.sandbox.commise.app')).toBe(false);
        });
    });

    describe('a deployed service with NEITHER selector — fails CLOSED', () => {
        const brokenInput: CorsPolicyInput = {
            deployed: true,
            authorizedPartiesRaw: undefined,
            previewBaseDomain: undefined,
            previewMode: undefined,
        };

        it('admits nothing at all', () => {
            const policy = resolveCorsPolicy(brokenInput);

            expect(policy.mode).toBe('closed');
            expect(admits(policy, 'https://commise.app')).toBe(false);
        });

        // ⚠️ THE REPRESENTATION IS LOAD-BEARING, NOT COSMETIC — but not for the reason folklore gives. `false`
        // does NOT emit `*` (`cors`'s `middlewareWrapper` short-circuits before `configureOrigin` can); it
        // removes the CORS middleware from the request path, so the denial stops being this policy's decision.
        // `corsHeaders.test.ts` proves that distinction over real HTTP; here the shape is simply pinned.
        it('expresses "closed" as an EMPTY LIST, never a boolean', () => {
            expect(resolveCorsPolicy(brokenInput).options.origin).toEqual([]);
        });
    });

    describe('a developer machine (not deployed) — loopback only, by choice', () => {
        it.each([
            'http://localhost:3000',
            'http://127.0.0.1:3000',
            'http://localhost:8081',
            'https://localhost:3000',
            'http://[::1]:3000',
            'http://localhost',
        ])('admits the loopback origin %s', (origin) => {
            expect(admits(resolveCorsPolicy(localInput), origin)).toBe(true);
        });

        it.each([
            'https://commise.app',
            'http://localhost.evil.example',
            'http://localhostx:3000',
            'http://127.0.0.1.evil.example',
            'http://evil.example#http://localhost:3000',
            'https://evil.example/http://localhost:3000',
        ])('refuses the non-loopback origin %s', (origin) => {
            expect(admits(resolveCorsPolicy(localInput), origin)).toBe(false);
        });

        it('reports the loopback mode', () => {
            expect(resolveCorsPolicy(localInput).mode).toBe('loopback');
        });

        it('still prefers an explicit list when one is set (the e2e harness sets one)', () => {
            const policy = resolveCorsPolicy({ ...localInput, authorizedPartiesRaw: 'http://localhost:3000' });

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
                deployed: true,
                authorizedPartiesRaw: undefined,
                previewBaseDomain: undefined,
                previewMode: undefined,
            },
        ];

        // The whole point of the type: `origin` cannot express "reflect whatever you are sent".
        it('never yields a boolean origin — the permissiveness is always an explicit matcher list', () => {
            for (const input of everyShape) {
                const { origin } = resolveCorsPolicy(input).options;

                expect(Array.isArray(origin)).toBe(true);
                expect(origin).not.toBe(true);
            }
        });

        // F2. Rewritten from "always sends credentials, which is what forbids a `*` wildcard". The list type is what
        // forbids `*` now. Credentials are a separate question, and a bearer-only service has no cookie to send, so
        // the header would only widen what a slip past the bearer-only guard could read.
        it('sends no credentials unless the adopter asks', () => {
            for (const input of everyShape) {
                expect(resolveCorsPolicy(input).options.credentials).toBe(false);
            }
        });

        it('sends credentials when the adopter asks for them, and changes nothing else', () => {
            for (const input of everyShape) {
                const asked = resolveCorsPolicy({ ...input, credentials: true });
                const plain = resolveCorsPolicy(input);

                expect(asked.options.credentials).toBe(true);
                expect({ ...asked.options, credentials: false }).toEqual(plain.options);
                expect(asked.mode).toBe(plain.mode);
            }
        });

        it('exposes Retry-After to the browser, so a 429 or a 503 can be retried on time (F3)', () => {
            for (const input of everyShape) {
                expect(resolveCorsPolicy(input).options.exposedHeaders).toEqual(['Retry-After']);
            }
        });

        it('lets the browser cache a preflight for ten minutes (F7)', () => {
            for (const input of everyShape) {
                expect(resolveCorsPolicy(input).options.maxAge).toBe(600);
            }
        });

        it('always allows the auth + content-type + distributed-tracing headers through preflight', () => {
            for (const input of everyShape) {
                expect(resolveCorsPolicy(input).options.allowedHeaders).toEqual(
                    expect.arrayContaining(['Content-Type', 'Authorization', 'sentry-trace', 'baggage']),
                );
            }
        });

        it('hands out a fresh header array per call — a caller cannot mutate the shared default', () => {
            const first = resolveCorsPolicy(prodInput).options.allowedHeaders;

            first.push('x-injected');

            expect(resolveCorsPolicy(prodInput).options.allowedHeaders).not.toContain('x-injected');
        });

        it('hands out a fresh exposed-header array per call too', () => {
            const first = resolveCorsPolicy(prodInput).options.exposedHeaders;

            first.push('x-injected');

            expect(resolveCorsPolicy(prodInput).options.exposedHeaders).not.toContain('x-injected');
        });
    });
});

describe('origins no policy may admit', () => {
    it.each(['', 'null', '*'])('refuses the origin %j in every mode', (origin) => {
        for (const input of [prodInput, sandboxInput, { ...sandboxInput, previewMode: 'transition' }, localInput]) {
            expect(admits(resolveCorsPolicy(input), origin)).toBe(false);
        }
    });

    // A `g` or `y` pattern keeps `lastIndex` between `test` calls, so the middleware would admit an origin once and
    // refuse it the next time. No policy may carry one.
    it('never hands out a stateful pattern', () => {
        for (const input of [sandboxInput, { ...sandboxInput, previewMode: 'transition' }, localInput]) {
            for (const entry of resolveCorsPolicy(input).options.origin) {
                expect(typeof entry === 'string' ? '' : entry.flags).not.toMatch(/[gy]/u);
            }
        }
    });
});
