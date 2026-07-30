/**
 * A PR preview must be built against ITS OWN backend. These tests pin the resolution rules, because the
 * failure they prevent is invisible in every other tier.
 *
 * ## The defect this closes
 *
 * `NEXT_PUBLIC_*` is inlined by the bundler at BUILD time, and the deployed pr-73 preview correctly embeds
 * `https://recipe-pr-73.commise.app` — but only because that literal was typed by hand into the Vercel
 * project's PREVIEW environment, which is project-scoped, not per-deployment. Every PR reads the same
 * variable, so PR 74's preview would have been built against **PR 73's recipe service**: a live, healthy,
 * completely unrelated deployment. Nothing would fail — the wrong data would simply appear, and the day PR
 * 73 closed and its stack was torn down, every other preview would break at once for no visible reason.
 *
 * ## Why a TEMPLATE and not a derived hostname
 *
 * The per-PR host shape already has exactly one owner: `recipeSubdomainForStage` in the recipe service's
 * CDK (`recipe-{stage}` → `recipe-pr-73.commise.app`). Re-deriving `recipe-pr-${pr}.commise.app` inside the
 * web app would duplicate that knowledge across a package boundary where nothing can keep the two in step.
 * So configuration supplies the whole URL with a `{pr}` placeholder and this module only substitutes — the
 * shape stays in config (which is where the owner directive put endpoint configuration), and the app learns
 * no hostnames.
 *
 * ## Why there is no fallback
 *
 * A preview build that cannot determine its PR number returns nothing rather than guessing. `src/config/env.ts`
 * then fails the build loudly for a missing endpoint, which is the whole point of that module having no
 * defaults. Guessing is what produced `http://localhost:3000` in a deployed bundle.
 */
import { describe, expect, it } from 'vitest';

import { resolveBuildEndpoints, substitutePrNumber } from '../previewEndpoints';

const PREVIEW = {
    VERCEL_ENV: 'preview',
    VERCEL_GIT_PULL_REQUEST_ID: '73',
    NEXT_PUBLIC_RECIPE_API_URL_TEMPLATE: 'https://recipe-pr-{pr}.commise.app',
    NEXT_PUBLIC_IDENTITY_API_URL_TEMPLATE: 'https://identity.sandbox.commise.app',
} as const;

describe('substitutePrNumber', () => {
    it('replaces every {pr} occurrence', () => {
        expect(substitutePrNumber('https://recipe-pr-{pr}.commise.app', '73')).toBe('https://recipe-pr-73.commise.app');
        expect(substitutePrNumber('{pr}-{pr}', '9')).toBe('9-9');
    });

    it('leaves a template with no placeholder untouched', () => {
        // The identity service is deliberately NOT per-PR — it is the one shared, persistent sandbox
        // deployable every preview signs in against — so its configured value carries no `{pr}`.
        expect(substitutePrNumber('https://identity.sandbox.commise.app', '73')).toBe(
            'https://identity.sandbox.commise.app',
        );
    });
});

describe('resolveBuildEndpoints', () => {
    it('resolves both endpoints for a preview build', () => {
        expect(resolveBuildEndpoints(PREVIEW)).toEqual({
            NEXT_PUBLIC_RECIPE_API_URL: 'https://recipe-pr-73.commise.app',
            NEXT_PUBLIC_IDENTITY_API_URL: 'https://identity.sandbox.commise.app',
        });
    });

    it('overrides a stale project-scoped value rather than deferring to it', () => {
        // THE core regression. A leftover project-wide `NEXT_PUBLIC_RECIPE_API_URL` is already in
        // `process.env` during a Vercel build, and `process.env` beats every `.env` file Next loads — so
        // writing a dotenv file would silently lose to it. The resolved value must win.
        const resolved = resolveBuildEndpoints({
            ...PREVIEW,
            NEXT_PUBLIC_RECIPE_API_URL: 'https://recipe-pr-73.commise.app',
        });

        expect(resolved['NEXT_PUBLIC_RECIPE_API_URL']).toBe('https://recipe-pr-73.commise.app');

        const stale = resolveBuildEndpoints({
            ...PREVIEW,
            NEXT_PUBLIC_RECIPE_API_URL: 'https://recipe-pr-11.commise.app',
        });

        expect(stale['NEXT_PUBLIC_RECIPE_API_URL']).toBe('https://recipe-pr-73.commise.app');
    });

    it('does NOTHING outside a preview build', () => {
        // Production takes its endpoints from the production pipeline's own environment; a local or CI build
        // takes them from what the caller exported. Neither may be rewritten from a preview template.
        expect(resolveBuildEndpoints({ ...PREVIEW, VERCEL_ENV: 'production' })).toEqual({});
        expect(resolveBuildEndpoints({ ...PREVIEW, VERCEL_ENV: 'development' })).toEqual({});
        // Not on Vercel at all (CI's build job, a developer's `npm run build`).
        expect(resolveBuildEndpoints({ NEXT_PUBLIC_RECIPE_API_URL_TEMPLATE: 'https://x-{pr}.example.com' })).toEqual(
            {},
        );
    });

    it('is INERT when no template is configured, even on a preview build', () => {
        // Two failure modes in one assertion, both about not breaking things this module has no business
        // touching:
        //
        //  1. The rollout. Until the `*_TEMPLATE` variables exist in the Vercel dashboard there is nothing to
        //     resolve, so every existing preview must keep building exactly as before from whatever the
        //     project supplies. Shipping a resolver that fails closed on absent config would have taken every
        //     preview down at merge.
        //  2. A branch deployment. Vercel sets `VERCEL_GIT_PULL_REQUEST_ID` only for a deployment that belongs
        //     to a PR, so a plain branch preview has none — and must not be failed for a template it was
        //     never given.
        expect(resolveBuildEndpoints({ VERCEL_ENV: 'preview' })).toEqual({});
        expect(resolveBuildEndpoints({ VERCEL_ENV: 'preview', VERCEL_GIT_PULL_REQUEST_ID: undefined })).toEqual({});
        expect(
            resolveBuildEndpoints({
                VERCEL_ENV: 'preview',
                NEXT_PUBLIC_RECIPE_API_URL: 'https://recipe-pr-73.commise.app',
            }),
        ).toEqual({});
    });

    it('THROWS on a preview build that HAS a template but no PR number', () => {
        // Once a per-PR template is configured, the PR number is load-bearing: better a failed build than a
        // preview pointed at whatever `{pr}` happened to interpolate to.
        expect(() => resolveBuildEndpoints({ ...PREVIEW, VERCEL_GIT_PULL_REQUEST_ID: undefined })).toThrow(
            /VERCEL_GIT_PULL_REQUEST_ID/,
        );
        expect(() => resolveBuildEndpoints({ ...PREVIEW, VERCEL_GIT_PULL_REQUEST_ID: '' })).toThrow(/pull request/i);
    });

    it('rejects a PR id that is not a plain number', () => {
        // Substituted straight into a hostname, so anything else is either a typo or an injection.
        expect(() => resolveBuildEndpoints({ ...PREVIEW, VERCEL_GIT_PULL_REQUEST_ID: '73/../evil' })).toThrow(
            /VERCEL_GIT_PULL_REQUEST_ID/,
        );
    });

    it('omits an endpoint whose template is unset, leaving env validation to fail loudly', () => {
        // Deliberately NOT a throw: the caller may legitimately supply one endpoint by template and the
        // other directly. `src/config/env.ts` is the single place that decides an endpoint is missing.
        expect(resolveBuildEndpoints({ ...PREVIEW, NEXT_PUBLIC_IDENTITY_API_URL_TEMPLATE: undefined })).toEqual({
            NEXT_PUBLIC_RECIPE_API_URL: 'https://recipe-pr-73.commise.app',
        });
    });

    it('treats a blank template as unset', () => {
        // A cleared dashboard field arrives as `''`, which would otherwise resolve to an empty endpoint.
        expect(resolveBuildEndpoints({ ...PREVIEW, NEXT_PUBLIC_RECIPE_API_URL_TEMPLATE: '   ' })).toEqual({
            NEXT_PUBLIC_IDENTITY_API_URL: 'https://identity.sandbox.commise.app',
        });
    });

    it('rejects a template that does not resolve to an absolute http(s) URL', () => {
        // Caught here as well as in `env.ts` so the failure names the TEMPLATE variable the operator has to
        // fix, not the derived variable they never set.
        expect(() =>
            resolveBuildEndpoints({ ...PREVIEW, NEXT_PUBLIC_RECIPE_API_URL_TEMPLATE: 'recipe-pr-{pr}.commise.app' }),
        ).toThrow(/NEXT_PUBLIC_RECIPE_API_URL_TEMPLATE/);
    });

    it('requires the RECIPE template to be per-PR, because the recipe service is', () => {
        // The topology rule, enforced at the one point config becomes a URL: recipe is deployed per PR, so
        // its preview template MUST carry `{pr}`. A fixed value can only be some OTHER PR's service or a
        // persistent instance that is not supposed to exist.
        //
        // A stage-qualified host is the motivating case, and it is why a hostname check is not enough on its
        // own: the `*.sandbox.commise.app` wildcard points at the shared ALB, so such a host RESOLVES and
        // answers a well-formed 404 on every request — it looks configured and fails like an application bug.
        // A fixed PER-PR host is just as wrong: it is some other PR's live service.
        for (const fixed of ['https://recipe.some-stage.commise.app', 'https://recipe-pr-73.commise.app']) {
            expect(() => resolveBuildEndpoints({ ...PREVIEW, NEXT_PUBLIC_RECIPE_API_URL_TEMPLATE: fixed })).toThrow(
                /\{pr\}/,
            );
        }
    });

    it('does NOT require the identity template to be per-PR', () => {
        // Identity is the deliberate asymmetry: one shared, persistent sandbox service (tagged
        // Environment=global, never torn down) that every preview signs in against. Demanding `{pr}` here
        // would be demanding a per-PR identity service, which is exactly what must NOT exist.
        expect(resolveBuildEndpoints(PREVIEW)['NEXT_PUBLIC_IDENTITY_API_URL']).toBe(
            'https://identity.sandbox.commise.app',
        );
    });
});
