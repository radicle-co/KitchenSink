// @vitest-environment node
/**
 * Repo-wide guard, LIVE tier: the deployed web front door must be stage-coherent and must terminate.
 *
 * This is the check whose absence let a broken production stand behind green CI. See
 * `prod-web-surface.test.ts` for the incident narrative and the hermetic proofs of every classifier used
 * here; this file only supplies the real artifact.
 *
 * ## Opt-in, and why that is a DISCLOSED GAP rather than a design choice
 *
 * The probe needs the public internet and a live deployment, so it runs only when `PROD_WEB_SMOKE_ORIGIN` is
 * set. That makes it inert in the default `vitest run` — deliberately, because wiring a production dependency
 * into every local and per-PR `npm run test` would turn any prod outage or offline laptop into a repo-wide
 * red build.
 *
 * **It is therefore NOT yet load-bearing.** It becomes load-bearing only once `prod-deploy.yml` runs it as a
 * post-deploy step:
 *
 * ```yaml
 * - name: Smoke test — production web surface (stage coherence + termination)
 *   working-directory: packages/infra/global
 *   env:
 *       PROD_WEB_SMOKE_ORIGIN: https://${{ vars.DOMAIN_NAME }}
 *   run: npx vitest run __tests__/prod-web-surface.integration.test.ts
 * ```
 *
 * Until that step exists this file is an opt-in diagnostic, and saying so is the point: an env-gated test
 * that nothing sets is the same class of silent pass that `workflow-invariants.test.ts` inventories.
 *
 * ## What it asserts, and why each assertion exists
 *
 * | Assertion | The blind spot it closes |
 * |---|---|
 * | the chain TERMINATES, with no URL visited twice | `routeProtection.spec.ts` polls until the first favourable sample, which an infinite bounce satisfies |
 * | no hop passes through a `*.clerk.accounts.dev` Frontend API | nothing anywhere asserted WHICH Clerk instance production serves |
 * | the served bundle is stage-coherent | the Clerk key is outside `src/config/env.ts`'s schema and lives only in the Vercel dashboard |
 * | the terminal response is a rendered `200`, not a redirect | every prod smoke asserted status on `identity./recipe./food.` health and never fetched a web page at all |
 *
 * ## Observed RED then GREEN against live production (2026-08-07)
 *
 * At 18:15 ET, `PROD_WEB_SMOKE_ORIGIN=https://commise.app` failed two assertions on the real deployment: the
 * handshake hop into `nice-fowl-6.clerk.accounts.dev`, and stage coherence — both
 * `NEXT_PUBLIC_IDENTITY_API_URL=https://identity.commise.app` and `NEXT_PUBLIC_RECIPE_API_URL` reported as
 * prod backends behind a `pk_test` bundle. At 18:21, after the Vercel Production publishable key was
 * corrected to `pk_live_Y2xlcmsuY29tbWlzZS5hcHAk` (`clerk.commise.app$`) and the app redeployed, all four
 * passed unchanged. That red→green transition on the live artifact is this guard's proof; no fixture was
 * involved.
 *
 * The TERMINATION assertion passed in BOTH states, which is the important caveat to record: the loop's return
 * hop is CLIENT-side JavaScript (`<SignIn forceRedirectUrl>` reacting to a valid clerk-js session), so an
 * HTTP-level chain can never see it, and `/{locale}` answers `200` rather than a `3xx` anyway — Next serves
 * an RSC `redirect()` as a document plus a client navigation. Catching the loop ITSELF requires the
 * navigation-count assertion in `packages/apps/commise/web/tests/e2e/routeProtection.spec.ts`.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import {
    classifyChainTermination,
    classifyHostStage,
    classifyStageCoherence,
    findDevInstanceHandshakeHops,
    parseBundleEndpoints,
    parseClerkInstance,
    probeWebSurface,
    type WebSurface,
} from './prod-web-surface.js';

const ORIGIN = process.env['PROD_WEB_SMOKE_ORIGIN'];
const LOCALE = process.env['PROD_WEB_SMOKE_LOCALE'] ?? 'en';
const MAX_HOPS = 10;

/**
 * Whether the probed origin is itself a production host. A Clerk DEVELOPMENT instance is the CORRECT
 * configuration for a sandbox preview, so the dev-handshake assertion is prod-only; stage COHERENCE, by
 * contrast, must hold at every stage and is asserted unconditionally.
 */
const PROBING_PROD = ORIGIN !== undefined && classifyHostStage(new URL(ORIGIN).hostname) === 'prod';

describe.runIf(ORIGIN !== undefined)(`deployed web surface — ${ORIGIN ?? '(not configured)'}`, () => {
    let surface: WebSurface;

    beforeAll(async () => {
        surface = await probeWebSurface(ORIGIN as string, `/${LOCALE}`, MAX_HOPS);
    }, 60_000);

    it('resolves the front door to a RENDERED page, not another redirect', () => {
        const chain = surface.hops.map((hop) => `${hop.status} ${hop.url}`).join('\n  ');

        expect(surface.finalStatus, `chain:\n  ${chain}`).toBe(200);
        expect(surface.html.length).toBeGreaterThan(0);
    });

    it('terminates the redirect chain without revisiting a URL', () => {
        const verdict = classifyChainTermination(surface.hops, MAX_HOPS);

        expect(verdict.findings.join('\n')).toBe('');
        expect(verdict.terminated).toBe(true);
    });

    it.runIf(PROBING_PROD)('never handshakes through a Clerk DEVELOPMENT Frontend API', () => {
        // A production Clerk instance completes its handshake on the app's own domain. A hop into
        // `*.clerk.accounts.dev` is conclusive: this deployment is running a development instance. Asserted
        // only for production origins — a sandbox preview SHOULD be on a dev instance.
        expect(findDevInstanceHandshakeHops(surface.hops).join('\n')).toBe('');
    });

    it('serves a STAGE-COHERENT bundle — the Clerk instance and every backend origin agree', () => {
        const clerk = parseClerkInstance(surface.html);
        const endpoints = parseBundleEndpoints(surface.bundleJs);
        const verdict = classifyStageCoherence({ clerk, endpoints });

        expect(
            verdict.findings.join('\n'),
            `clerk=${clerk?.publishableKey.slice(0, 11)}… @ ${clerk?.frontendApiHost}\n` +
                `endpoints=${JSON.stringify(endpoints)}`,
        ).toBe('');
        expect(verdict.coherent).toBe(true);
    });
});
