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
    classifyHealth,
    classifyImageCurrency,
    classifyPreflight,
    runSmoke,
} from '../smoke/deployedSmoke.js';

const ORIGIN = 'https://pr-73.sandbox.commise.app';
const FOOD_ORIGIN = 'https://food-pr-73.commise.app';

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

    it('accepts a wildcard allow-origin', () => {
        expect(classifyPreflight(ORIGIN, { status: 204, allowOrigin: '*' }).ok).toBe(true);
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
 * The preflight check asserts a BROWSER can reach the service. That is the right assertion for identity and
 * recipe, which both call `app.enableCors(…)` in `main.ts` and are called cross-origin by the web app. The
 * FOOD service deliberately has no `enableCors` at all: nothing outside the cluster calls it, and its only
 * consumer is the recipe service server-to-server (`foodCatalog.gateway.ts`). So sending it a preflight
 * asserts something that is false by design — `OPTIONS /api/v1/recipes` against food is an app 404, which
 * `classifyPreflight` correctly rejects.
 *
 * The alternative was to give food CORS purely so a smoke could pass, i.e. open a browser-facing surface
 * with no browser consumer to satisfy a check. Skipping the check the way the food/ecosystem checks are
 * already skipped (by omitting their flag) is the honest shape, and `prodDeploySmokeDepth.test.ts`
 * derives WHICH services must supply the flag from whether their `main.ts` enables CORS — so a service that
 * gains CORS immediately owes the assertion, and one that has it cannot silently drop it.
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
        // The #152 gap: food's smoke needs the currency check and CANNOT take the preflight, so the two
        // must be independently selectable. If currency were coupled to the web origin, closing food's
        // gap would have been impossible without giving it CORS.
        stubFetch(() => new Response('{}', { status: 200 }));

        const verdicts = await runSmoke({
            baseUrl: 'https://food.commise.app',
            expectedImageTag: 'abc123',
            runningImageTag: 'stale99',
        });

        expect(verdicts.some((verdict) => !verdict.ok && verdict.reason.includes('STALE'))).toBe(true);
    });

    it('RUNS the preflight when a web origin IS supplied', async () => {
        const seen = stubFetch((_url, init) =>
            init?.method === 'OPTIONS'
                ? new Response(null, { status: 204, headers: { 'access-control-allow-origin': ORIGIN } })
                : new Response('{}', { status: 200 }),
        );

        const verdicts = await runSmoke({ baseUrl: 'https://recipe.commise.app', webOrigin: ORIGIN });

        expect(seen).toContain('OPTIONS https://recipe.commise.app/api/v1/recipes');
        expect(verdicts.every((verdict) => verdict.ok)).toBe(true);
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
