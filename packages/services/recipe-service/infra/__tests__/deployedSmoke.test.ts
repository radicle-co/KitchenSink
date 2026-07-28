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
 */
import { describe, expect, it } from 'vitest';

import { classifyHealth, classifyImageCurrency, classifyPreflight } from '../smoke/deployedSmoke.js';

const ORIGIN = 'https://pr-73.sandbox.commise.app';

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
        // The deployed service answered `OPTIONS /v1/recipes` with 401 "Missing bearer token" because its
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
