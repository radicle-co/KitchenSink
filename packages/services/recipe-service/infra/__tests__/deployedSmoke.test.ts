/**
 * The post-deploy smoke contract for the recipe service — the check whose absence let a broken deployment
 * sit undetected for fifteen days.
 *
 * ## What went wrong, and why "is it running?" could not see it
 *
 * The `pr-73` recipe service was deployed 2026-07-13. CORS was added to the service on 2026-07-15
 * (`1bba364f`). Nothing ever redeployed it, so the running container never gained CORS — and every browser
 * call from the web app failed. Meanwhile:
 *
 *   - `GET /health` returned **200** the entire time (the service WAS running — just stale),
 *   - `cdk synth` exited **0** (the SSM dependency resolves at deploy time, not synth),
 *   - k6, Playwright, Maestro and the integration suites all passed (each boots or mocks its OWN backend).
 *
 * So liveness, static analysis and the whole test pyramid were individually green while the deployed
 * artifact was unusable. The three assertions below are the ones that would each independently have caught
 * it, and they are deliberately about the DEPLOYED artifact rather than the code:
 *
 *   1. `classifyHealth`   — the service answers at all.
 *   2. `classifyPreflight`— a BROWSER can reach it cross-origin. A CORS preflight is sent WITHOUT
 *      credentials by spec, so a service whose auth middleware runs first answers `401` and is unreachable
 *      from every browser while remaining perfectly healthy to curl. This is the exact observed failure.
 *   3. `classifyImageCurrency` — what is running is what we just built. Staleness is invisible to both of
 *      the above: a correct, healthy, CORS-enabled OLD build passes them and is still wrong.
 *
 * ## The fourth and fifth blind spots (issue #124): the service is fine, the ECOSYSTEM is not
 *
 * All three checks above interrogate ONE service in isolation, so all three stay green on a preview whose
 * cross-service wiring is broken — which is what `pr-73` shipped: `RECIPE_FOOD_SERVICE_URL` is a REQUIRED
 * prop naming `https://food-pr-{N}.commise.app`, but the food deploy job was gated on food paths, so a
 * recipe-only PR pointed a healthy recipe service at a host that did not exist. Everything answered 200
 * except the blended USDA catalog, which degraded to `catalogAvailability: 'unavailable'` in silence.
 *
 *   4. `classifyDependencyWiring`      — the RUNNING recipe task is configured for THIS PR's food service.
 *   5. `classifyDependencyReachability`— that food origin actually answers.
 *
 * Check 5 is the one with a trap: `food-pr-{N}.commise.app/api/v1/foods/search` answers **401 by design** (it
 * requires a Clerk-verified token). So "200 or bust" is exactly the wrong assertion — a 401 from the real
 * host is PROOF of reachability (DNS → shared-ALB host rule → the food service's own auth layer all had to
 * work to produce it), whereas a transport failure or the shared ALB's default `404 text/plain` proves the
 * opposite. Both directions are asserted below.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    classifyDependencyReachability,
    classifyDependencyWiring,
    classifyEdgeUnauthorized,
    classifyHealth,
    classifyImageCurrency,
    classifyForeignPreflight,
    classifyPreflight,
    classifyPreflightDenied,
    classifyUnauthorized,
    EDGE_GENERATED_X_CACHE,
    FOREIGN_PREFLIGHT_ORIGIN,
    failureAnnotation,
    main,
    parsePreflightRoute,
    runEdgeUnauthorizedSmoke,
    runSmoke,
    type CorsExpectation,
    type PreflightRoute,
    type UnauthorizedObservation,
} from '../smoke/deployedSmoke.js';

const ORIGIN = 'https://pr-73.sandbox.commise.app';
const FOOD_ORIGIN = 'https://food-pr-73.commise.app';

/** The `Origin` a stubbed request carried, or `undefined`. */
function originOf(init: RequestInit | undefined): string | undefined {
    return new Headers(init?.headers).get('origin') ?? undefined;
}

/** The method a stubbed preflight asked for, or `undefined`. */
function requestedMethodOf(init: RequestInit | undefined): string | undefined {
    return new Headers(init?.headers).get('access-control-request-method') ?? undefined;
}

/**
 * A preflight answered the way the shared CORS policy answers it: the allow-origin echoes `admitted` and nothing else.
 * A stub that sent a fixed allow-origin to every caller would fail the foreign-origin check, which is correct: no
 * policy of ours does that.
 */
function admitOnly(admitted: string): (url: string, init?: RequestInit) => Response {
    return (_url, init) => {
        if (init?.method !== 'OPTIONS') {
            return new Response('{}', { status: 200 });
        }

        return originOf(init) === admitted
            ? new Response(null, { status: 204, headers: { 'access-control-allow-origin': admitted } })
            : new Response(null, { status: 204 });
    };
}

describe('classifyHealth', () => {
    it('passes on 200', () => {
        expect(classifyHealth(200).ok).toBe(true);
    });

    it('fails on anything else, naming the status', () => {
        const verdict = classifyHealth(503);

        expect(verdict.ok).toBe(false);
        expect(verdict.reason).toContain('503');
    });
});

describe('classifyPreflight', () => {
    it('passes when the preflight is answered with a matching allow-origin', () => {
        expect(classifyPreflight(ORIGIN, { status: 204, allowOrigin: ORIGIN }).ok).toBe(true);
    });

    it('accepts any 2xx, since services answer preflights with 200 or 204', () => {
        expect(classifyPreflight(ORIGIN, { status: 200, allowOrigin: ORIGIN }).ok).toBe(true);
    });

    it('FAILS on a 401 — the exact defect that shipped', () => {
        // The deployed service answered `OPTIONS /api/v1/recipes` with 401 "Missing bearer token" because its
        // auth middleware ran before CORS. Browsers never attach credentials to a preflight, so this makes
        // the API unreachable from every browser while `GET /health` still returns 200.
        const verdict = classifyPreflight(ORIGIN, { status: 401 });

        expect(verdict.ok).toBe(false);
        expect(verdict.reason).toMatch(/preflight/i);
        expect(verdict.reason).toMatch(/credential/i);
    });

    it('fails when the preflight succeeds but carries no allow-origin header', () => {
        // A pre-CORS build: the request is answered, the browser still blocks the response.
        const verdict = classifyPreflight(ORIGIN, { status: 204 });

        expect(verdict.ok).toBe(false);
        expect(verdict.reason).toMatch(/access-control-allow-origin/i);
    });

    it('fails when the allow-origin names a DIFFERENT origin', () => {
        const verdict = classifyPreflight(ORIGIN, { status: 204, allowOrigin: 'https://commise.app' });

        expect(verdict.ok).toBe(false);
        expect(verdict.reason).toContain('https://commise.app');
    });

    // Rewritten from "accepts a wildcard allow-origin" (plan 002 S4 review, F4). No policy of ours sends `*`: the
    // shared policy's origin is always a list. A `*` therefore means the service is not running that policy, and a
    // smoke that passed it would pass a service open to every origin.
    it('FAILS on a wildcard allow-origin, which admits every origin', () => {
        const verdict = classifyPreflight(ORIGIN, { status: 204, allowOrigin: '*' });

        expect(verdict.ok).toBe(false);
        expect(verdict.reason).toContain('*');
    });
});

/**
 * The other direction (plan 002 S2): a service that must NOT be callable from a browser, or a path on a
 * browser-facing service that must not be. A smoke that can only assert "admits" cannot hold either line.
 */
describe('classifyPreflightDenied', () => {
    it.each([
        ['no allow-origin at all, answered 204', { status: 204 }],
        ['no allow-origin, answered by the router with 404', { status: 404 }],
        ['an allow-origin naming a DIFFERENT origin', { status: 204, allowOrigin: 'https://commise.app' }],
        ['a credential-less refusal', { status: 401 }],
    ])('passes on %s', (_, observed) => {
        expect(classifyPreflightDenied(ORIGIN, observed).ok).toBe(true);
    });

    it('FAILS when the preflight admits the caller, naming the origin', () => {
        const verdict = classifyPreflightDenied(ORIGIN, { status: 204, allowOrigin: ORIGIN });

        expect(verdict.ok).toBe(false);
        expect(verdict.reason).toContain(ORIGIN);
    });

    it('FAILS on a wildcard, which admits every origin', () => {
        expect(classifyPreflightDenied(ORIGIN, { status: 204, allowOrigin: '*' }).ok).toBe(false);
    });

    it('FAILS on a 5xx: an erroring service proves nothing about its CORS policy', () => {
        expect(classifyPreflightDenied(ORIGIN, { status: 502 }).ok).toBe(false);
    });
});

describe('classifyForeignPreflight — an origin nothing admits must get NO allow-origin', () => {
    it('is an origin under a reserved top-level domain, so it can never be a real caller', () => {
        expect(new URL(FOREIGN_PREFLIGHT_ORIGIN).hostname.endsWith('.invalid')).toBe(true);
        expect(FOREIGN_PREFLIGHT_ORIGIN).toBe(new URL(FOREIGN_PREFLIGHT_ORIGIN).origin);
    });

    it.each([
        ['the CORS middleware refusing the match', 204],
        ["the router's 404 on a service with no CORS", 404],
        ['an auth layer answering first', 401],
    ])('passes on %s, with no allow-origin', (_label, status) => {
        expect(classifyForeignPreflight({ status }).ok).toBe(true);
    });

    // ⛔ The case F4 exists for: a service that reflects any origin passes every admit check, because it reflects the
    // web origin too. Only a probe from an origin nobody admits can see it.
    it('FAILS when the foreign origin is reflected back, naming it', () => {
        const verdict = classifyForeignPreflight({ status: 204, allowOrigin: FOREIGN_PREFLIGHT_ORIGIN });

        expect(verdict.ok).toBe(false);
        expect(verdict.reason).toContain(FOREIGN_PREFLIGHT_ORIGIN);
    });

    it('FAILS on a wildcard', () => {
        expect(classifyForeignPreflight({ status: 204, allowOrigin: '*' }).ok).toBe(false);
    });

    // Stricter than `classifyPreflightDenied`, on purpose: our policy never sends a fixed allow-origin, so ANY value
    // here means the service is not running it.
    it('FAILS on any other allow-origin value too', () => {
        expect(classifyForeignPreflight({ status: 204, allowOrigin: ORIGIN }).ok).toBe(false);
    });

    it('FAILS on a 5xx, which proves nothing about the policy', () => {
        expect(classifyForeignPreflight({ status: 502 }).ok).toBe(false);
    });

    it('treats an empty allow-origin as absent', () => {
        expect(classifyForeignPreflight({ status: 204, allowOrigin: '' }).ok).toBe(true);
    });
});

describe('failureAnnotation', () => {
    it('names the service by the origin it probed, not as "the recipe service"', () => {
        const annotation = failureAnnotation('https://food.commise.app');

        expect(annotation).toContain('https://food.commise.app');
        expect(annotation).not.toMatch(/recipe/iu);
        expect(annotation.startsWith('::error::')).toBe(true);
    });
});

describe('classifyImageCurrency', () => {
    it('passes when the running image is the one just built', () => {
        expect(classifyImageCurrency('pr-73-ceca226f', 'pr-73-ceca226f').ok).toBe(true);
    });

    it('fails when the running image is stale, naming both tags', () => {
        // The 15-day drift, made visible. Without this, a healthy service that predates the fix passes.
        const verdict = classifyImageCurrency('pr-73', 'pr-73-ceca226f');

        expect(verdict.ok).toBe(false);
        expect(verdict.reason).toContain('pr-73-ceca226f');
        expect(verdict.reason).toMatch(/stale|expected/i);
    });

    it('fails when the running tag cannot be determined', () => {
        expect(classifyImageCurrency(undefined, 'pr-73-ceca226f').ok).toBe(false);
    });
});

describe("classifyDependencyWiring — the RUNNING recipe task points at THIS PR's food service", () => {
    it('passes when the configured origin is the expected one', () => {
        expect(classifyDependencyWiring(FOOD_ORIGIN, FOOD_ORIGIN).ok).toBe(true);
    });

    it('tolerates a trailing slash and host casing, which name the same origin', () => {
        expect(classifyDependencyWiring(FOOD_ORIGIN, `${FOOD_ORIGIN}/`).ok).toBe(true);
        expect(classifyDependencyWiring(FOOD_ORIGIN, 'https://FOOD-PR-73.commise.app').ok).toBe(true);
    });

    // The defect that shipped: `props.foodServiceUrl` was optional and no workflow set
    // RECIPE_FOOD_SERVICE_URL, so the live task definition carried no FOOD_* variables at all.
    it('FAILS when the running task carries no food origin at all', () => {
        const verdict = classifyDependencyWiring(FOOD_ORIGIN, undefined);

        expect(verdict.ok).toBe(false);
        expect(verdict.reason).toMatch(/FOOD_SERVICE_URL/);
    });

    it('fails on an empty configured origin', () => {
        expect(classifyDependencyWiring(FOOD_ORIGIN, '').ok).toBe(false);
    });

    // Cross-wiring is worse than no wiring: a preview reading the SHARED sandbox/prod catalog looks like it
    // works while testing someone else's data, and writes its typeahead load onto another stage.
    it("FAILS when the task points at another stage's food service, naming both origins", () => {
        const verdict = classifyDependencyWiring(FOOD_ORIGIN, 'https://food.commise.app');

        expect(verdict.ok).toBe(false);
        expect(verdict.reason).toContain('https://food.commise.app');
        expect(verdict.reason).toContain(FOOD_ORIGIN);
    });

    it("fails when a different PR's food service is configured", () => {
        expect(classifyDependencyWiring(FOOD_ORIGIN, 'https://food-pr-59.commise.app').ok).toBe(false);
    });

    it('fails when the configured value is not an absolute origin', () => {
        expect(classifyDependencyWiring(FOOD_ORIGIN, 'food-pr-73.commise.app').ok).toBe(false);
    });
});

describe('classifyDependencyReachability — 401 proves reachability; unreachable and the ALB 404 do not', () => {
    // ⛔ The trap. `GET /api/v1/foods/search` without a Clerk token is SUPPOSED to be rejected, so demanding a
    // 200 here would fail every correctly-wired preview. What the probe proves is that the request reached
    // the food service at all: DNS resolved, the shared ALB matched this PR's host rule, and food's auth
    // layer ran. That is the whole assertion.
    it('PASSES on 401 — the correct rejection of an unauthenticated probe', () => {
        const verdict = classifyDependencyReachability(FOOD_ORIGIN, {
            outcome: 'responded',
            status: 401,
            contentType: 'application/json',
        });

        expect(verdict.ok).toBe(true);
        expect(verdict.reason).toMatch(/401/);
    });

    it('passes on 403 as well — also an auth decision, so also proof the service answered', () => {
        expect(classifyDependencyReachability(FOOD_ORIGIN, { outcome: 'responded', status: 403 }).ok).toBe(true);
    });

    // Only the food service itself can rate-limit (the shared ALB has no such action), so a 429 is still
    // proof the request arrived — and food deliberately sheds repeated 401s per source (FR-052).
    it('passes on 429 — only the service itself can shed load, so the request arrived', () => {
        expect(classifyDependencyReachability(FOOD_ORIGIN, { outcome: 'responded', status: 429 }).ok).toBe(true);
    });

    // The other direction. This is the state a recipe-only PR was left in before issue #124: the host has
    // no DNS record, so nothing answers.
    it('FAILS when nothing answered at all, and says the per-PR food service is missing', () => {
        const verdict = classifyDependencyReachability(FOOD_ORIGIN, {
            outcome: 'no-response',
            detail: 'getaddrinfo ENOTFOUND food-pr-73.commise.app',
        });

        expect(verdict.ok).toBe(false);
        expect(verdict.reason).toContain('ENOTFOUND');
        expect(verdict.reason).toMatch(/food/i);
    });

    // The shared ALB answers every unmatched host with a fixed `404 text/plain` "Not Found" (ADR-0003), so
    // this is the signature of "DNS resolves but this PR's listener rule was never created" — a DIFFERENT
    // failure from an absent host, and the message must not conflate them.
    it('FAILS on the shared ALB default 404 (text/plain), and names the missing listener rule', () => {
        const verdict = classifyDependencyReachability(FOOD_ORIGIN, {
            outcome: 'responded',
            status: 404,
            contentType: 'text/plain; charset=utf-8',
        });

        expect(verdict.ok).toBe(false);
        expect(verdict.reason).toMatch(/listener rule|not routed/i);
    });

    // A JSON 404 came from a Nest app, so the host IS routed — the route is missing, i.e. a version skew
    // between the deployed food service and the API recipe expects.
    it('fails on a JSON 404 with a different reason — routed, but the endpoint is gone', () => {
        const verdict = classifyDependencyReachability(FOOD_ORIGIN, {
            outcome: 'responded',
            status: 404,
            contentType: 'application/json; charset=utf-8',
        });

        expect(verdict.ok).toBe(false);
        expect(verdict.reason).toMatch(/route|endpoint/i);
        expect(verdict.reason).not.toMatch(/listener rule/i);
    });

    // ROLLOUT SAFETY (ADR-0011). The probe dials the CANONICAL `/api/v1/foods/search`, but the food service
    // deploys independently of recipe — and the sandbox deploy gate (ADR-0010) can legitimately SKIP food's
    // deploy and still run this smoke. So a food service that predates the `/api` prefix answers a JSON 404
    // on canonical while still happily serving the deprecated `/v1` alias. That is a VERSION SKEW, not a
    // broken deployment: the ecosystem this check exists to prove (DNS → ALB host rule → food's auth layer)
    // is demonstrably intact. Failing the deploy for it would be a false red, so the probe retries the alias
    // and this classifier passes on the alias's own evidence — while saying plainly that the dependency has
    // not shipped the prefix yet, so the signal is never silently lost.
    it('PASSES when canonical 404s but the DEPRECATED alias answers 401 — a version skew, not an outage', () => {
        const verdict = classifyDependencyReachability(
            FOOD_ORIGIN,
            { outcome: 'responded', status: 404, contentType: 'application/json; charset=utf-8' },
            { outcome: 'responded', status: 401, contentType: 'application/json; charset=utf-8' },
        );

        expect(verdict.ok).toBe(true);
        expect(verdict.reason).toMatch(/deprecated|alias/i);
        expect(verdict.reason).toMatch(/401/);
    });

    it('still FAILS when neither the canonical path nor the alias answers usefully', () => {
        const verdict = classifyDependencyReachability(
            FOOD_ORIGIN,
            { outcome: 'responded', status: 404, contentType: 'application/json; charset=utf-8' },
            { outcome: 'responded', status: 404, contentType: 'application/json; charset=utf-8' },
        );

        expect(verdict.ok).toBe(false);
        expect(verdict.reason).toMatch(/route|endpoint/i);
    });

    it('ignores an alias observation when the canonical path already answered 401', () => {
        const verdict = classifyDependencyReachability(
            FOOD_ORIGIN,
            { outcome: 'responded', status: 401 },
            { outcome: 'responded', status: 500 },
        );

        expect(verdict.ok).toBe(true);
        expect(verdict.reason).not.toMatch(/deprecated|alias/i);
    });

    // An UNAUTHENTICATED 200 is not good news: the catalog requires a Clerk-verified token, so either the
    // auth guard is gone or something other than the food service is answering this host.
    it('FAILS on a 2xx to an unauthenticated probe — the auth boundary is open', () => {
        const verdict = classifyDependencyReachability(FOOD_ORIGIN, { outcome: 'responded', status: 200 });

        expect(verdict.ok).toBe(false);
        expect(verdict.reason).toMatch(/unauthenticated/i);
    });

    it('fails on a 5xx — routed, but the food service is erroring', () => {
        const verdict = classifyDependencyReachability(FOOD_ORIGIN, { outcome: 'responded', status: 503 });

        expect(verdict.ok).toBe(false);
        expect(verdict.reason).toContain('503');
    });

    it('fails on a redirect, which no API client follows blindly', () => {
        expect(classifyDependencyReachability(FOOD_ORIGIN, { outcome: 'responded', status: 302 }).ok).toBe(false);
    });

    it('names the dependency origin in every verdict, so the log says WHICH host was probed', () => {
        const observations = [
            { outcome: 'no-response', detail: 'boom' },
            { outcome: 'responded', status: 401 },
            { outcome: 'responded', status: 404, contentType: 'text/plain' },
            { outcome: 'responded', status: 200 },
            { outcome: 'responded', status: 500 },
        ] as const;

        for (const observation of observations) {
            expect(classifyDependencyReachability(FOOD_ORIGIN, observation).reason).toContain(FOOD_ORIGIN);
        }
    });
});

/**
 * `runSmoke`'s composition — which checks it runs, given which inputs.
 *
 * ## Why `--web-origin` had to become OPTIONAL (task #152)
 *
 * The preflight check asserts what a BROWSER can do. A service whose `main.ts` calls `app.enableCors(…)` must
 * ADMIT the web origin on its preflights; one with no `enableCors` must REFUSE it (`expectCors: 'deny'`, plan 002
 * S2). `prodDeploySmokeDepth.test.ts` derives which one each deploy leg owes from the service's `main.ts`. Omitting
 * the web origin still skips every preflight.
 */
describe('runSmoke composition', () => {
    /** A fetch stub that records what was requested and answers from a fixed script. */
    function stubFetch(handler: (url: string, init?: RequestInit) => Response): readonly string[] {
        const seen: string[] = [];

        vi.stubGlobal('fetch', (input: string | URL, init?: RequestInit) => {
            const url = String(input);

            seen.push(`${init?.method ?? 'GET'} ${url}`);

            return Promise.resolve(handler(url, init));
        });

        return seen;
    }

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('SKIPS the preflight entirely when no web origin is supplied', async () => {
        const seen = stubFetch(() => new Response('{}', { status: 200 }));

        const verdicts = await runSmoke({ baseUrl: 'https://food.commise.app' });

        expect(seen).toEqual(['GET https://food.commise.app/health']);
        expect(verdicts.map((verdict) => verdict.reason)).toEqual(['health returned 200']);
    });

    it('still asserts image currency without a web origin', async () => {
        // The #152 gap: the currency check must not depend on the web origin. Food's currency check landed
        // before its preflight did, which a coupled design would have made impossible.
        stubFetch(() => new Response('{}', { status: 200 }));

        const verdicts = await runSmoke({
            baseUrl: 'https://food.commise.app',
            expectedImageTag: 'abc123',
            runningImageTag: 'stale99',
        });

        expect(verdicts.some((verdict) => !verdict.ok && verdict.reason.includes('STALE'))).toBe(true);
    });

    it('RUNS the preflight when a web origin IS supplied', async () => {
        const seen = stubFetch(admitOnly(ORIGIN));

        const verdicts = await runSmoke({ baseUrl: 'https://recipe.commise.app', webOrigin: ORIGIN });

        expect(seen).toContain('OPTIONS https://recipe.commise.app/api/v1/recipes');
        expect(verdicts.every((verdict) => verdict.ok)).toBe(true);
    });

    it('also preflights each path from an origin nothing admits', async () => {
        const origins: (string | undefined)[] = [];

        stubFetch((url, init) => {
            if (init?.method === 'OPTIONS') {
                origins.push(`${originOf(init)} ${url}`);
            }

            return admitOnly(ORIGIN)(url, init);
        });

        const verdicts = await runSmoke({
            baseUrl: 'https://food.commise.app',
            webOrigin: ORIGIN,
            preflightRoutes: [
                { method: 'GET', path: '/api/v1/foods/search/live' },
                { method: 'GET', path: '/api/v1/foods/nutrition' },
            ],
        });

        expect(origins).toEqual([
            `${ORIGIN} https://food.commise.app/api/v1/foods/search/live`,
            `${FOREIGN_PREFLIGHT_ORIGIN} https://food.commise.app/api/v1/foods/search/live`,
            `${ORIGIN} https://food.commise.app/api/v1/foods/nutrition`,
            `${FOREIGN_PREFLIGHT_ORIGIN} https://food.commise.app/api/v1/foods/nutrition`,
        ]);
        expect(verdicts.every((verdict) => verdict.ok)).toBe(true);
    });

    // ⛔ THE REGRESSION F4 closes. A service that reflects ANY origin echoes the web origin as well, so every admit
    // check passed it. The foreign preflight is the only one that can tell.
    it('FAILS a service that reflects any origin, though it admits the web origin', async () => {
        stubFetch((_url, init) =>
            init?.method === 'OPTIONS'
                ? new Response(null, {
                      status: 204,
                      headers: { 'access-control-allow-origin': originOf(init) ?? '' },
                  })
                : new Response('{}', { status: 200 }),
        );

        const verdicts = await runSmoke({ baseUrl: 'https://recipe.commise.app', webOrigin: ORIGIN });

        expect(verdicts.filter((verdict) => !verdict.ok).map((verdict) => verdict.reason)).toEqual([
            expect.stringContaining(FOREIGN_PREFLIGHT_ORIGIN),
        ]);
    });

    it('preflights every --preflight-path given, instead of the recipe path', async () => {
        const seen = stubFetch(admitOnly(ORIGIN));

        const verdicts = await runSmoke({
            baseUrl: 'https://identity.commise.app',
            webOrigin: ORIGIN,
            preflightRoutes: [
                { method: 'GET', path: '/api/v1/users/me' },
                { method: 'GET', path: '/api/v1/users/me/avatar' },
            ],
        });

        // Each path twice: once from the web origin, once from the foreign one.
        expect(seen.filter((line) => line.startsWith('OPTIONS'))).toEqual([
            'OPTIONS https://identity.commise.app/api/v1/users/me',
            'OPTIONS https://identity.commise.app/api/v1/users/me',
            'OPTIONS https://identity.commise.app/api/v1/users/me/avatar',
            'OPTIONS https://identity.commise.app/api/v1/users/me/avatar',
        ]);
        expect(verdicts.filter((verdict) => verdict.reason.includes('/api/v1/users/me'))).toHaveLength(4);
        expect(verdicts.every((verdict) => verdict.ok)).toBe(true);
    });

    it('asserts a REFUSAL on every path when the expectation is deny', async () => {
        // A service with no CORS: the preflight carries no allow-origin, and the check passes.
        stubFetch((_url, init) =>
            init?.method === 'OPTIONS' ? new Response(null, { status: 404 }) : new Response('{}', { status: 200 }),
        );

        const denied = await runSmoke({
            baseUrl: 'https://food.commise.app',
            webOrigin: ORIGIN,
            preflightRoutes: [{ method: 'GET', path: '/api/v1/foods/search/live' }],
            expectCors: 'deny',
        });

        expect(denied.every((verdict) => verdict.ok)).toBe(true);
        expect(denied.some((verdict) => verdict.reason.includes('/api/v1/foods/search/live'))).toBe(true);

        // …and it goes red the day food starts admitting the origin without the smoke being flipped.
        vi.unstubAllGlobals();
        stubFetch((_url, init) =>
            init?.method === 'OPTIONS'
                ? new Response(null, { status: 204, headers: { 'access-control-allow-origin': ORIGIN } })
                : new Response('{}', { status: 200 }),
        );

        const admitted = await runSmoke({
            baseUrl: 'https://food.commise.app',
            webOrigin: ORIGIN,
            preflightRoutes: [{ method: 'GET', path: '/api/v1/foods/search/live' }],
            expectCors: 'deny',
        });

        expect(admitted.some((verdict) => !verdict.ok)).toBe(true);
    });

    it('asserts a refusal on every --deny-preflight-path, even when the rest must admit', async () => {
        const seen = stubFetch(admitOnly(ORIGIN));

        const verdicts = await runSmoke({
            baseUrl: 'https://food.commise.app',
            webOrigin: ORIGIN,
            preflightRoutes: [{ method: 'GET', path: '/api/v1/foods/search/live' }],
            denyPreflightRoutes: [{ method: 'GET', path: '/api/v1/foods/nutrition' }],
        });

        expect(seen).toContain('OPTIONS https://food.commise.app/api/v1/foods/nutrition');
        // The nutrition path admitted the origin, so its deny assertion fails while the admit one passes.
        expect(verdicts.find((verdict) => verdict.reason.includes('/api/v1/foods/nutrition'))?.ok).toBe(false);
        expect(verdicts.find((verdict) => verdict.reason.includes('/api/v1/foods/search/live'))?.ok).toBe(true);
    });

    it('asks each preflight, from both origins, for the method its route is called with', async () => {
        const asked: string[] = [];

        stubFetch((url, init) => {
            if (init?.method === 'OPTIONS') {
                asked.push(`${requestedMethodOf(init) ?? 'none'} ${originOf(init) ?? 'none'} ${url}`);
            }

            return admitOnly(ORIGIN)(url, init);
        });

        const verdicts = await runSmoke({
            baseUrl: 'https://food.commise.app',
            webOrigin: ORIGIN,
            preflightRoutes: [
                { method: 'POST', path: '/api/v1/foods/remote/adopt' },
                { method: 'GET', path: '/api/v1/foods/catalog/search' },
            ],
            denyPreflightRoutes: [{ method: 'POST', path: '/api/v1/foods/batch' }],
        });

        expect(asked).toEqual([
            `POST ${ORIGIN} https://food.commise.app/api/v1/foods/remote/adopt`,
            `POST ${FOREIGN_PREFLIGHT_ORIGIN} https://food.commise.app/api/v1/foods/remote/adopt`,
            `GET ${ORIGIN} https://food.commise.app/api/v1/foods/catalog/search`,
            `GET ${FOREIGN_PREFLIGHT_ORIGIN} https://food.commise.app/api/v1/foods/catalog/search`,
            `POST ${ORIGIN} https://food.commise.app/api/v1/foods/batch`,
        ]);
        expect(verdicts.find((verdict) => verdict.reason.startsWith('POST /api/v1/foods/remote/adopt: '))?.ok).toBe(
            true,
        );
    });

    it('FAILS the preflight when a web origin is supplied and CORS is absent', async () => {
        // The negative control for the case above: "optional" must not have become "never enforced".
        stubFetch((_url, init) =>
            init?.method === 'OPTIONS' ? new Response(null, { status: 204 }) : new Response('{}', { status: 200 }),
        );

        const verdicts = await runSmoke({ baseUrl: 'https://recipe.commise.app', webOrigin: ORIGIN });

        expect(verdicts.some((verdict) => !verdict.ok && /access-control-allow-origin/.test(verdict.reason))).toBe(
            true,
        );
    });
});

/**
 * The service's own `401` to a tokenless request (ADR-0047; plan 002 S7.10). Where no edge stands in front of the
 * origin (every stage but prod, ADR-0020), the origin's CORS layer answers it, and a browser can read "sign in again"
 * only if that `401` admits the web origin.
 */
describe("classifyUnauthorized — the origin's own 401 admits the web origin and nothing else", () => {
    it.each<[string, string, CorsExpectation, UnauthorizedObservation, boolean]>([
        [
            'a 401 that admits the web origin, with no x-cache',
            ORIGIN,
            'admit',
            { status: 401, allowOrigin: ORIGIN },
            true,
        ],
        ['a 401 that refuses an origin nothing admits', FOREIGN_PREFLIGHT_ORIGIN, 'deny', { status: 401 }, true],
        ['a 401 that refuses the web origin where it must', ORIGIN, 'deny', { status: 401 }, true],
        ['a 401 with no allow-origin for the web origin', ORIGIN, 'admit', { status: 401 }, false],
        ['a 401 allowing every origin', ORIGIN, 'admit', { status: 401, allowOrigin: '*' }, false],
        [
            'a 401 allowing another origin',
            ORIGIN,
            'admit',
            { status: 401, allowOrigin: FOREIGN_PREFLIGHT_ORIGIN },
            false,
        ],
        [
            'a 401 admitting an origin nothing admits',
            FOREIGN_PREFLIGHT_ORIGIN,
            'deny',
            { status: 401, allowOrigin: FOREIGN_PREFLIGHT_ORIGIN },
            false,
        ],
    ])('judges %s', (_label, origin, expectation, observed, ok) => {
        const verdict = classifyUnauthorized(origin, expectation, observed);

        expect(verdict.ok, verdict.reason).toBe(ok);
        expect(verdict.reason).toContain(origin);
    });

    it.each([200, 403, 404, 429, 502])('FAILS a %s: the service must refuse a tokenless request 401', (status) => {
        const verdict = classifyUnauthorized(ORIGIN, 'admit', { status, allowOrigin: ORIGIN });

        expect(verdict.ok).toBe(false);
        expect(verdict.reason).toContain(String(status));
    });
});

describe('runSmoke — the tokenless 401 on each --unauthorized-path', () => {
    const PATH = '/api/v1/foods/search/progressive';

    /**
     * A fetch stub answering as food does: preflights by the shared policy, and a tokenless GET with its own `401`,
     * whose `Allow-Origin` echoes the web origin only when `admitsWebOrigin`. It records method, URL, Origin and
     * whether a bearer was sent.
     */
    function stubOrigin(admitsWebOrigin: boolean): string[] {
        const seen: string[] = [];

        vi.stubGlobal('fetch', (input: string | URL, init?: RequestInit) => {
            const url = String(input);
            const headers = new Headers(init?.headers);

            if (init?.method === 'OPTIONS') {
                return Promise.resolve(admitOnly(ORIGIN)(url, init));
            }

            if (url.endsWith('/health')) {
                return Promise.resolve(new Response('{}', { status: 200 }));
            }

            seen.push(
                `${init?.method ?? 'GET'} ${url} ${originOf(init) ?? '(no origin)'} ${String(headers.has('authorization'))}`,
            );

            return Promise.resolve(
                new Response('{"code":"UNAUTHORIZED"}', {
                    status: 401,
                    headers:
                        admitsWebOrigin && originOf(init) === ORIGIN ? { 'access-control-allow-origin': ORIGIN } : {},
                }),
            );
        });

        return seen;
    }

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('sends one tokenless GET from the web origin and one from an origin nothing admits', async () => {
        const seen = stubOrigin(true);

        const verdicts = await runSmoke({
            baseUrl: 'https://food-pr-73.commise.app',
            webOrigin: ORIGIN,
            preflightRoutes: [{ method: 'GET', path: PATH }],
            unauthorizedPaths: [PATH],
        });

        expect(seen).toEqual([
            `GET https://food-pr-73.commise.app${PATH} ${ORIGIN} false`,
            `GET https://food-pr-73.commise.app${PATH} ${FOREIGN_PREFLIGHT_ORIGIN} false`,
        ]);
        expect(verdicts.every((verdict) => verdict.ok)).toBe(true);
    });

    it('fails, naming the path, when the 401 carries no CORS headers for the web origin', async () => {
        stubOrigin(false);

        const verdicts = await runSmoke({
            baseUrl: 'https://food-pr-73.commise.app',
            webOrigin: ORIGIN,
            preflightRoutes: [{ method: 'GET', path: PATH }],
            unauthorizedPaths: [PATH],
        });

        expect(verdicts.filter((verdict) => !verdict.ok).map((verdict) => verdict.reason)).toEqual([
            expect.stringContaining(PATH),
        ]);
    });

    it('holds the 401 to --expect-cors deny, as the preflights are held', async () => {
        stubOrigin(true);

        const verdicts = await runSmoke({
            baseUrl: 'https://food-pr-73.commise.app',
            webOrigin: ORIGIN,
            preflightRoutes: [],
            expectCors: 'deny',
            unauthorizedPaths: [PATH],
        });

        expect(verdicts.filter((verdict) => !verdict.ok).map((verdict) => verdict.reason)).toEqual([
            expect.stringContaining(ORIGIN),
        ]);
    });

    it('sends nothing tokenless without a web origin, as the preflights are skipped', async () => {
        const seen = stubOrigin(true);

        await runSmoke({ baseUrl: 'https://food-pr-73.commise.app', unauthorizedPaths: [PATH] });

        expect(seen).toEqual([]);
    });

    it('turns a transport failure into a failing verdict rather than a crash', async () => {
        vi.stubGlobal('fetch', (input: string | URL, init?: RequestInit) =>
            init?.method === undefined && String(input).endsWith(PATH)
                ? Promise.reject(new Error('socket hang up'))
                : Promise.resolve(new Response('{}', { status: 200 })),
        );

        const verdicts = await runSmoke({
            baseUrl: 'https://food-pr-73.commise.app',
            webOrigin: ORIGIN,
            preflightRoutes: [],
            unauthorizedPaths: [PATH],
        });

        expect(verdicts.filter((verdict) => !verdict.ok).map((verdict) => verdict.reason)).toEqual([
            expect.stringContaining('socket hang up'),
            expect.stringContaining('socket hang up'),
        ]);
    });
});

describe('parsePreflightRoute — a flag value names a path, or a method and a path', () => {
    it.each<[string, PreflightRoute]>([
        ['/api/v1/recipes', { method: 'GET', path: '/api/v1/recipes' }],
        ['GET:/api/v1/foods/catalog/search', { method: 'GET', path: '/api/v1/foods/catalog/search' }],
        ['POST:/api/v1/foods/remote/adopt', { method: 'POST', path: '/api/v1/foods/remote/adopt' }],
    ])('reads %s', (spec, route) => {
        expect(parsePreflightRoute(spec)).toStrictEqual(route);
    });

    it.each<[string, string]>([
        ['a method no deploy leg preflights', 'PUT:/api/v1/foods/remote/adopt'],
        ['a method spelled in lower case', 'post:/api/v1/foods/remote/adopt'],
        ['a method and path joined by a space', 'POST /api/v1/foods/remote/adopt'],
        ['a method with no path', 'POST:'],
        ['a path with no leading slash', 'api/v1/recipes'],
        ['nothing', ''],
    ])('refuses %s', (_label, spec) => {
        expect(() => parsePreflightRoute(spec)).toThrow(TypeError);
    });
});

describe('main — the CLI', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        process.exitCode = undefined;
    });

    it('takes repeatable --preflight-path and --deny-preflight-path flags and --expect-cors deny', async () => {
        const seen: string[] = [];

        vi.stubGlobal('fetch', (input: string | URL, init?: RequestInit) => {
            seen.push(`${init?.method ?? 'GET'} ${String(input)}`);

            return Promise.resolve(
                init?.method === 'OPTIONS' ? new Response(null, { status: 404 }) : new Response('{}', { status: 200 }),
            );
        });
        vi.spyOn(console, 'log').mockImplementation(() => undefined);

        await main([
            '--base-url',
            'https://food.commise.app',
            '--web-origin',
            ORIGIN,
            '--preflight-path',
            '/api/v1/foods/search/live',
            '--preflight-path',
            '/api/v1/foods/catalog-search',
            '--deny-preflight-path',
            '/api/v1/foods/nutrition',
            '--expect-cors',
            'deny',
        ]);

        expect(process.exitCode).toBeUndefined();
        // Each --preflight-path from the web origin and then from the foreign one; the deny path once.
        expect(seen.filter((line) => line.startsWith('OPTIONS'))).toEqual([
            'OPTIONS https://food.commise.app/api/v1/foods/search/live',
            'OPTIONS https://food.commise.app/api/v1/foods/search/live',
            'OPTIONS https://food.commise.app/api/v1/foods/catalog-search',
            'OPTIONS https://food.commise.app/api/v1/foods/catalog-search',
            'OPTIONS https://food.commise.app/api/v1/foods/nutrition',
        ]);
    });

    it('sends a --preflight-path that names POST as a POST preflight', async () => {
        const asked: (string | undefined)[] = [];

        vi.stubGlobal('fetch', (input: string | URL, init?: RequestInit) => {
            if (init?.method === 'OPTIONS') {
                asked.push(requestedMethodOf(init));
            }

            return Promise.resolve(admitOnly(ORIGIN)(String(input), init));
        });
        vi.spyOn(console, 'log').mockImplementation(() => undefined);

        await main([
            '--base-url',
            'https://food.commise.app',
            '--web-origin',
            ORIGIN,
            '--preflight-path',
            'POST:/api/v1/foods/remote/adopt',
        ]);

        expect(process.exitCode).toBeUndefined();
        expect(asked).toEqual(['POST', 'POST']);
    });

    it.each(['--preflight-path', '--deny-preflight-path'])(
        'refuses a %s naming a method it does not know with the usage exit code, sending nothing',
        async (flag) => {
            const fetched = vi.fn(() => Promise.resolve(new Response('{}', { status: 200 })));

            vi.stubGlobal('fetch', fetched);
            vi.spyOn(console, 'error').mockImplementation(() => undefined);

            await main(['--base-url', 'https://food.commise.app', '--web-origin', ORIGIN, flag, 'PUT:/x']);

            expect(process.exitCode).toBe(2);
            expect(fetched).not.toHaveBeenCalled();
        },
    );

    it('takes a repeatable --unauthorized-path, and exits 1 when a 401 carries no CORS headers', async () => {
        const tokenless: string[] = [];

        vi.stubGlobal('fetch', (input: string | URL, init?: RequestInit) => {
            const url = String(input);

            if (init?.method === undefined && !url.endsWith('/health')) {
                tokenless.push(url);

                return Promise.resolve(new Response('{}', { status: 401 }));
            }

            return Promise.resolve(admitOnly(ORIGIN)(url, init));
        });
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);

        await main([
            '--base-url',
            'https://food.commise.app',
            '--web-origin',
            ORIGIN,
            '--unauthorized-path',
            '/api/v1/foods/search/progressive',
            '--unauthorized-path',
            '/api/v1/foods/catalog/search',
        ]);

        expect(tokenless).toEqual([
            'https://food.commise.app/api/v1/foods/search/progressive',
            'https://food.commise.app/api/v1/foods/search/progressive',
            'https://food.commise.app/api/v1/foods/catalog/search',
            'https://food.commise.app/api/v1/foods/catalog/search',
        ]);
        expect(process.exitCode).toBe(1);
    });

    it('refuses an --expect-cors value other than admit or deny, with the usage exit code', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);

        await main(['--base-url', 'https://food.commise.app', '--expect-cors', 'maybe']);

        expect(process.exitCode).toBe(2);
    });

    it('names the probed origin in the failure annotation', async () => {
        vi.stubGlobal('fetch', () => Promise.resolve(new Response('{}', { status: 503 })));
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        await main(['--base-url', 'https://identity.commise.app']);

        expect(process.exitCode).toBe(1);
        expect(errors.mock.calls.flat().join('\n')).toContain('https://identity.commise.app');
    });
});

/**
 * The edge's own `401` (plan 002 C1). CloudFront's viewer-request verifier answers a tokenless request itself, so the
 * origin's CORS layer never sees it: unless the edge adds the headers, a browser reports a network error where the
 * edge said "sign in again". Measured on prod before the fix: `x-cache: LambdaGeneratedResponse from cloudfront` and
 * no `access-control-*` header at all.
 */
describe("classifyEdgeUnauthorized — the edge's 401 admits the web origin and nothing else", () => {
    const EDGE_401 = { status: 401, xCache: EDGE_GENERATED_X_CACHE } as const;

    it('passes an edge 401 that admits the web origin', () => {
        expect(classifyEdgeUnauthorized(ORIGIN, 'admit', { ...EDGE_401, allowOrigin: ORIGIN }).ok).toBe(true);
    });

    it('passes an edge 401 that refuses an origin nothing admits', () => {
        expect(classifyEdgeUnauthorized(FOREIGN_PREFLIGHT_ORIGIN, 'deny', EDGE_401).ok).toBe(true);
    });

    it('FAILS an edge 401 with no Allow-Origin for the web origin, and says the version may still be propagating', () => {
        const verdict = classifyEdgeUnauthorized(ORIGIN, 'admit', EDGE_401);

        expect(verdict.ok).toBe(false);
        expect(verdict.reason).toMatch(/access-control-allow-origin/u);
        expect(verdict.reason).toMatch(/propagat/u);
    });

    it.each(['*', 'https://evil.invalid'])('FAILS an edge 401 that allows %s for the web origin', (allowOrigin) => {
        expect(classifyEdgeUnauthorized(ORIGIN, 'admit', { ...EDGE_401, allowOrigin }).ok).toBe(false);
    });

    it('FAILS an edge 401 that admits an origin nothing admits', () => {
        const verdict = classifyEdgeUnauthorized(FOREIGN_PREFLIGHT_ORIGIN, 'deny', {
            ...EDGE_401,
            allowOrigin: FOREIGN_PREFLIGHT_ORIGIN,
        });

        expect(verdict.ok).toBe(false);
        expect(verdict.reason).toContain(FOREIGN_PREFLIGHT_ORIGIN);
    });

    // A 401 the ORIGIN sent proves nothing about the edge's verifier, however good its headers are.
    it.each<[string, string | undefined]>([
        ['a cache miss the origin answered', 'Miss from cloudfront'],
        ['no x-cache at all (not CloudFront)', undefined],
    ])('FAILS a 401 that is %s', (_label, xCache) => {
        const verdict = classifyEdgeUnauthorized(ORIGIN, 'admit', { status: 401, xCache, allowOrigin: ORIGIN });

        expect(verdict.ok).toBe(false);
        expect(verdict.reason).toContain('x-cache');
    });

    it.each([200, 403, 404, 502])('FAILS a %s: the edge must refuse a tokenless request itself', (status) => {
        const verdict = classifyEdgeUnauthorized(ORIGIN, 'admit', {
            status,
            xCache: EDGE_GENERATED_X_CACHE,
            allowOrigin: ORIGIN,
        });

        expect(verdict.ok).toBe(false);
        expect(verdict.reason).toContain(String(status));
    });
});

describe('the edge mode — one tokenless GET from the web origin and one from an origin nothing admits', () => {
    const PROBE = '/api/v1/edge-smoke';

    /** A fetch stub answering as the edge does once its new version is live; it records method, URL and Origin. */
    function stubEdge(admitsWebOrigin: boolean): string[] {
        const seen: string[] = [];

        vi.stubGlobal('fetch', (input: string | URL, init?: RequestInit) => {
            const origin = originOf(init);

            seen.push(`${init?.method ?? 'GET'} ${String(input)} ${origin ?? '(no origin)'}`);
            expect(new Headers(init?.headers).has('authorization')).toBe(false);

            return Promise.resolve(
                new Response('{"code":"UNAUTHORIZED"}', {
                    status: 401,
                    headers: {
                        'x-cache': EDGE_GENERATED_X_CACHE,
                        ...(admitsWebOrigin && origin === ORIGIN ? { 'access-control-allow-origin': ORIGIN } : {}),
                    },
                }),
            );
        });

        return seen;
    }

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        process.exitCode = undefined;
    });

    it('probes the path from both origins, with no token, and nothing else', async () => {
        const seen = stubEdge(true);

        const verdicts = await runEdgeUnauthorizedSmoke({
            baseUrl: 'https://food.commise.app',
            webOrigin: ORIGIN,
            path: PROBE,
        });

        expect(seen).toEqual([
            `GET https://food.commise.app${PROBE} ${ORIGIN}`,
            `GET https://food.commise.app${PROBE} ${FOREIGN_PREFLIGHT_ORIGIN}`,
        ]);
        expect(verdicts.map((verdict) => verdict.ok)).toEqual([true, true]);
    });

    it('fails, naming the path, while the edge still answers without CORS headers', async () => {
        stubEdge(false);

        const verdicts = await runEdgeUnauthorizedSmoke({
            baseUrl: 'https://food.commise.app',
            webOrigin: ORIGIN,
            path: PROBE,
        });

        expect(verdicts.filter((verdict) => !verdict.ok).map((verdict) => verdict.reason)).toEqual([
            expect.stringContaining(PROBE),
        ]);
    });

    it('turns a transport failure into a failing verdict rather than a crash', async () => {
        vi.stubGlobal('fetch', () => Promise.reject(new Error('getaddrinfo ENOTFOUND food.commise.app')));

        const verdicts = await runEdgeUnauthorizedSmoke({
            baseUrl: 'https://food.commise.app',
            webOrigin: ORIGIN,
            path: PROBE,
        });

        expect(verdicts.every((verdict) => !verdict.ok)).toBe(true);
        expect(verdicts[0]?.reason).toContain('ENOTFOUND');
    });

    it('is what the CLI runs for --edge-unauthorized-path, and it exits 1 on a failure', async () => {
        const seen = stubEdge(false);

        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);

        await main([
            '--base-url',
            'https://food.commise.app',
            '--web-origin',
            ORIGIN,
            '--edge-unauthorized-path',
            PROBE,
        ]);

        expect(seen).toHaveLength(2);
        expect(process.exitCode).toBe(1);
    });

    it('exits 0 from the CLI when the edge admits the web origin and refuses the foreign one', async () => {
        stubEdge(true);
        vi.spyOn(console, 'log').mockImplementation(() => undefined);

        await main([
            '--base-url',
            'https://food.commise.app',
            '--web-origin',
            ORIGIN,
            '--edge-unauthorized-path',
            PROBE,
        ]);

        expect(process.exitCode).toBeUndefined();
    });

    it.each<[string, readonly string[]]>([
        ['without --web-origin', []],
        ['beside a per-service flag it would silently ignore', ['--web-origin', ORIGIN, '--preflight-path', '/x']],
    ])('refuses --edge-unauthorized-path %s, with the usage exit code', async (_label, rest) => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);

        await main(['--base-url', 'https://food.commise.app', '--edge-unauthorized-path', PROBE, ...rest]);

        expect(process.exitCode).toBe(2);
    });
});
