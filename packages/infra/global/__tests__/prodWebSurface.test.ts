// @vitest-environment node
/**
 * Repo-wide guard: a deployed web bundle must be STAGE-COHERENT, and the signed-out front door must
 * TERMINATE. Hermetic tier — proves the classifiers red/green against fixtures, including a fixture captured
 * from the real broken production surface. The live probe lives in `prodWebSurface.integration.test.ts`.
 *
 * ## The failure this pins (production outage, 2026-08-07)
 *
 * `commise.app/en` bounced forever between `/en` and `/en/sign-in?redirect_url=%2Fen`. Root cause: the
 * production Vercel build carried the SANDBOX Clerk dev instance —
 * `pk_test_bmljZS1mb3dsLTYuY2xlcmsuYWNjb3VudHMuZGV2JA`, which base64-decodes to
 * `nice-fowl-6.clerk.accounts.dev$` — while `NEXT_PUBLIC_IDENTITY_API_URL` was compiled as
 * `https://identity.commise.app`. Prod identity verifies networklessly against
 * `/kitchensink/prod/clerk/jwt-public-key` (the `clerk.commise.app` key, a different RSA modulus), so every
 * token the browser minted failed signature verification and `GET /api/v1/users/me` returned `401`
 * permanently. The 401 handler bounced to sign-in; the client session was valid, so `<SignIn>`'s
 * `forceRedirectUrl` sent the visitor straight back. Infinite loop, no error surfaced.
 *
 * ## Why nothing caught it, and what that dictates here
 *
 * | Existing gate | Why it was blind |
 * |---|---|
 * | `prod-deploy.yml` smoke | probes `identity./recipe./food.` health only; nothing ever fetches a web page — and Vercel deploys web outside this repo entirely |
 * | `src/config/env.ts` | validates the two API URLs but the Clerk key is not in its schema and is never read by app code |
 * | `e2e-web` (`_ci.yml`) | hard-codes `stage: sandbox` because `pk_live` is domain-locked and cannot initialize on `localhost` — so a `pk_test` in prod is precisely the config CI validates |
 * | `routeProtection.spec.ts` | `expect.poll(() => isRoute(…, '/sign-in')).toBe(true)` passes on the FIRST favourable sample of an infinite bounce |
 *
 * So the assertions here are deliberately shaped against those blind spots:
 *
 * | Invariant | Test |
 * |---|---|
 * | Clerk instance and every compiled-in backend belong to the same stage | `classifyStageCoherence` block |
 * | An unrecognized origin is a FAILURE, never a silent pass | "refuses to classify an unrecognized origin" |
 * | A chain that keeps revisiting a URL is a CYCLE, not a redirect | `classifyChainTermination` block |
 * | A hop through `*.clerk.accounts.dev` proves prod runs a dev instance | `findDevInstanceHandshakeHops` block |
 *
 * ## Mutation check (performed, 2026-08-07)
 *
 * Relaxing `classifyHostStage` to return `'non-prod'` instead of `'unknown'` for an unknown host makes
 * "refuses to classify an unrecognized origin" and "FAILS an unrecognized backend origin" fail. Raising the
 * revisit threshold in `classifyChainTermination` makes "reports a chain that keeps revisiting a URL as a
 * CYCLE" fail; lowering it to one makes "tolerates ONE round trip back to the same URL" fail — the two
 * bracket the rule from both sides.
 */
import { describe, expect, it } from 'vitest';

import {
    classifyChainTermination,
    classifyHostStage,
    classifyStageCoherence,
    findDevInstanceHandshakeHops,
    parseBundleEndpoints,
    parseClerkInstance,
    type Hop,
} from './prodWebSurface.js';

/** Build a `pk_live`/`pk_test` the way Clerk does: prefix + base64 of `<frontend-api-host>$`. */
function publishableKey(kind: 'live' | 'test', frontendApiHost: string): string {
    return `pk_${kind}_${Buffer.from(`${frontendApiHost}$`, 'utf8').toString('base64')}`;
}

/** The Clerk loader script tag, as `@clerk/nextjs` renders it into the served document. */
function documentLoading(key: string, host: string): string {
    return `<script src="https://${host}/npm/@clerk/clerk-js@5/dist/clerk.browser.js" data-clerk-js-script="true" async="" crossorigin="anonymous" data-clerk-publishable-key="${key}"></script>`;
}

/** Captured VERBATIM from `https://www.commise.app/en` on 2026-08-07, while production was looping. */
const BROKEN_PROD_KEY = 'pk_test_bmljZS1mb3dsLTYuY2xlcmsuYWNjb3VudHMuZGV2JA';
const BROKEN_PROD_HTML = documentLoading(BROKEN_PROD_KEY, 'nice-fowl-6.clerk.accounts.dev');
/** Captured VERBATIM from chunk `2484-ba9068394ca19063.js` of that same deployment. */
const BROKEN_PROD_BUNDLE =
    'CIPE_API_URL:"https://recipe.commise.app",NEXT_PUBLIC_IDENTITY_API_URL:"https://identity.commise.app"},emptyStringAsUndefined:!0';

describe('parseClerkInstance', () => {
    it('reads the instance production was ACTUALLY serving, decoding the key to its Frontend API host', () => {
        expect(parseClerkInstance(BROKEN_PROD_HTML)).toEqual({
            publishableKey: BROKEN_PROD_KEY,
            kind: 'test',
            frontendApiHost: 'nice-fowl-6.clerk.accounts.dev',
        });
    });

    it('reads a correctly-configured production instance', () => {
        const key = publishableKey('live', 'clerk.commise.app');

        expect(parseClerkInstance(documentLoading(key, 'clerk.commise.app'))).toEqual({
            publishableKey: key,
            kind: 'live',
            frontendApiHost: 'clerk.commise.app',
        });
    });

    it('returns null for a document that loads no Clerk script (so callers fail rather than assume)', () => {
        expect(parseClerkInstance('<html><body>hello</body></html>')).toBeNull();
    });

    /**
     * The terminator used to be OPTIONAL (`replace(/\$$/, '')`), so a payload encoding `clerk.commise.app`
     * with no `$` was returned as a production instance and could make `classifyStageCoherence` pass —
     * for a key clerk-js itself refuses. The rule mirrored here is Clerk's own `isValidDecodedPublishableKey`
     * (`@clerk/shared` 4.30.1): the decoded payload must end in `$`, carry no other `$`, and name a host
     * with a dot. A key Clerk would not load is not a Clerk instance, and the probe must not say it is.
     */
    describe('refuses a key clerk-js itself would refuse', () => {
        function keyWithPayload(kind: 'live' | 'test', payload: string): string {
            return `pk_${kind}_${Buffer.from(payload, 'utf8').toString('base64')}`;
        }

        it('a decodable payload with NO trailing `$` is not an instance', () => {
            const key = keyWithPayload('live', 'clerk.commise.app');

            expect(parseClerkInstance(documentLoading(key, 'clerk.commise.app'))).toBeNull();
        });

        it('a payload with a `$` before the terminator is not an instance', () => {
            const key = keyWithPayload('live', 'clerk$commise.app$');

            expect(parseClerkInstance(documentLoading(key, 'clerk.commise.app'))).toBeNull();
        });

        it('a payload whose host has no dot is not an instance', () => {
            const key = keyWithPayload('test', 'localhost$');

            expect(parseClerkInstance(documentLoading(key, 'localhost'))).toBeNull();
        });

        it('a payload that is not base64 of anything is not an instance', () => {
            expect(parseClerkInstance(documentLoading('pk_live_!!!!', 'clerk.commise.app'))).toBeNull();
        });

        it('so a document carrying only such a key is reported INCOHERENT, never as production', () => {
            const key = keyWithPayload('live', 'clerk.commise.app');
            const verdict = classifyStageCoherence({
                clerk: parseClerkInstance(documentLoading(key, 'clerk.commise.app')),
                endpoints: { NEXT_PUBLIC_IDENTITY_API_URL: 'https://identity.commise.app' },
            });

            expect(verdict.coherent).toBe(false);
        });
    });
});

describe('parseBundleEndpoints', () => {
    it('recovers the build-time-inlined backend origins from real chunk JavaScript', () => {
        expect(parseBundleEndpoints(BROKEN_PROD_BUNDLE)).toEqual({
            NEXT_PUBLIC_IDENTITY_API_URL: 'https://identity.commise.app',
        });
    });

    it('recovers every NEXT_PUBLIC_*_API_URL, not just the first', () => {
        const js =
            'NEXT_PUBLIC_RECIPE_API_URL:"https://recipe.commise.app",NEXT_PUBLIC_IDENTITY_API_URL:"https://identity.commise.app"';

        expect(parseBundleEndpoints(js)).toEqual({
            NEXT_PUBLIC_RECIPE_API_URL: 'https://recipe.commise.app',
            NEXT_PUBLIC_IDENTITY_API_URL: 'https://identity.commise.app',
        });
    });
});

describe('classifyHostStage', () => {
    it.each([
        ['commise.app', 'prod'],
        ['www.commise.app', 'prod'],
        ['identity.commise.app', 'prod'],
        ['recipe.commise.app', 'prod'],
        ['clerk.commise.app', 'prod'],
        ['sandbox.commise.app', 'prod'],
        ['identity.sandbox.commise.app', 'non-prod'],
        ['pr-73.sandbox.commise.app', 'non-prod'],
        ['pr-73.commise.app', 'non-prod'],
        ['nice-fowl-6.clerk.accounts.dev', 'non-prod'],
        ['localhost', 'non-prod'],
    ] as const)('classifies %s as %s', (host, stage) => {
        expect(classifyHostStage(host)).toBe(stage);
    });

    it('refuses to classify an unrecognized origin — an unknown host must never read as coherent', () => {
        expect(classifyHostStage('identity.example.com')).toBe('unknown');
        expect(classifyHostStage('evil.test')).toBe('unknown');
    });
});

describe('classifyStageCoherence', () => {
    it('FAILS the exact production bundle that was live during the loop', () => {
        const verdict = classifyStageCoherence({
            clerk: parseClerkInstance(BROKEN_PROD_HTML),
            endpoints: parseBundleEndpoints(BROKEN_PROD_BUNDLE),
        });

        expect(verdict.coherent).toBe(false);
        expect(verdict.findings.join('\n')).toContain('NEXT_PUBLIC_IDENTITY_API_URL=https://identity.commise.app');
        expect(verdict.findings.join('\n')).toContain('non-prod Clerk instance');
    });

    it('PASSES the same bundle once the Clerk instance is corrected to production — the fix, asserted', () => {
        const key = publishableKey('live', 'clerk.commise.app');

        const verdict = classifyStageCoherence({
            clerk: parseClerkInstance(documentLoading(key, 'clerk.commise.app')),
            endpoints: parseBundleEndpoints(BROKEN_PROD_BUNDLE),
        });

        expect(verdict).toEqual({ coherent: true, findings: [] });
    });

    it('FAILS the INVERSE mistake too — a prod Clerk instance pointed at sandbox backends', () => {
        const verdict = classifyStageCoherence({
            clerk: parseClerkInstance(
                documentLoading(publishableKey('live', 'clerk.commise.app'), 'clerk.commise.app'),
            ),
            endpoints: { NEXT_PUBLIC_IDENTITY_API_URL: 'https://identity.sandbox.commise.app' },
        });

        expect(verdict.coherent).toBe(false);
    });

    it('PASSES a coherent sandbox preview bundle (the guard is stage-agnostic, not prod-only)', () => {
        const key = publishableKey('test', 'nice-fowl-6.clerk.accounts.dev');

        const verdict = classifyStageCoherence({
            clerk: parseClerkInstance(documentLoading(key, 'nice-fowl-6.clerk.accounts.dev')),
            endpoints: {
                NEXT_PUBLIC_IDENTITY_API_URL: 'https://identity.sandbox.commise.app',
                NEXT_PUBLIC_RECIPE_API_URL: 'https://recipe-pr-73.sandbox.commise.app',
            },
        });

        expect(verdict).toEqual({ coherent: true, findings: [] });
    });

    it('FAILS a bundle with NO endpoints — an empty scan must not be mistaken for a clean one', () => {
        const key = publishableKey('live', 'clerk.commise.app');

        const verdict = classifyStageCoherence({
            clerk: parseClerkInstance(documentLoading(key, 'clerk.commise.app')),
            endpoints: {},
        });

        expect(verdict.coherent).toBe(false);
        expect(verdict.findings.join('\n')).toContain('cannot prove stage coherence');
    });

    it('FAILS when no Clerk key is present at all', () => {
        expect(classifyStageCoherence({ clerk: null, endpoints: {} }).coherent).toBe(false);
    });

    it('FAILS an unrecognized backend origin rather than passing it', () => {
        const key = publishableKey('live', 'clerk.commise.app');

        const verdict = classifyStageCoherence({
            clerk: parseClerkInstance(documentLoading(key, 'clerk.commise.app')),
            endpoints: { NEXT_PUBLIC_IDENTITY_API_URL: 'https://identity.example.com' },
        });

        expect(verdict.coherent).toBe(false);
        expect(verdict.findings.join('\n')).toContain('unrecognized origin');
    });
});

describe('classifyChainTermination', () => {
    const hop = (url: string, status: number, location?: string): Hop => ({ url, status, location });

    it('accepts the real, healthy signed-out chain (apex 308 → www 200)', () => {
        const verdict = classifyChainTermination(
            [
                hop('https://commise.app/en', 308, 'https://www.commise.app/en'),
                hop('https://www.commise.app/en', 307, 'https://www.commise.app/en/sign-in'),
                hop('https://www.commise.app/en/sign-in', 200),
            ],
            10,
        );

        expect(verdict).toEqual({ terminated: true, findings: [] });
    });

    it('reports a chain that keeps revisiting a URL as a CYCLE — the assertion routeProtection.spec.ts lacks', () => {
        const home = 'https://www.commise.app/en';
        const signIn = 'https://www.commise.app/en/sign-in?redirect_url=%2Fen';

        const verdict = classifyChainTermination(
            [
                hop(home, 307, signIn),
                hop(signIn, 307, home),
                hop(home, 307, signIn),
                hop(signIn, 307, home),
                hop(home, 307, signIn),
            ],
            10,
        );

        expect(verdict.terminated).toBe(false);
        expect(verdict.findings.join('\n')).toContain('redirect CYCLE');
    });

    it('tolerates ONE round trip back to the same URL — an auth handshake is not a loop', () => {
        // A Clerk dev-instance handshake legitimately leaves and returns: /en → FAPI → /en?__clerk_handshake
        // → /en → 200. Flagging that as a cycle would make the guard cry wolf on every sandbox preview,
        // where a development instance is the CORRECT configuration.
        const verdict = classifyChainTermination(
            [
                hop('https://www.commise.app/en', 307, 'https://fapi.example/v1/client/handshake'),
                hop('https://fapi.example/v1/client/handshake', 307, 'https://www.commise.app/en?__clerk_handshake=x'),
                hop('https://www.commise.app/en?__clerk_handshake=x', 307, 'https://www.commise.app/en'),
                hop('https://www.commise.app/en', 200),
            ],
            10,
        );

        expect(verdict).toEqual({ terminated: true, findings: [] });
    });

    it('reports exhausting the hop budget as a failure, even without an exact URL repeat', () => {
        const hops = Array.from({ length: 4 }, (_, i) =>
            hop(`https://www.commise.app/en?h=${i}`, 307, `/en?h=${i + 1}`),
        );

        const verdict = classifyChainTermination(hops, 4);

        expect(verdict.terminated).toBe(false);
        expect(verdict.findings.join('\n')).toContain('did not terminate within 4 hops');
    });

    it('reports an empty chain as a failure — an unreachable origin is never a pass', () => {
        expect(classifyChainTermination([], 10).terminated).toBe(false);
    });
});

describe('findDevInstanceHandshakeHops', () => {
    it('flags the dev-browser handshake production was actually performing', () => {
        // Captured 2026-08-07: www.commise.app/en 307'd into the sandbox dev instance's Frontend API to mint
        // a `__clerk_db_jwt`, with `x-clerk-auth-reason: dev-browser-missing`.
        const findings = findDevInstanceHandshakeHops([
            {
                url: 'https://www.commise.app/en',
                status: 307,
                location: 'https://nice-fowl-6.clerk.accounts.dev/v1/client/handshake?redirect_url=x',
            },
            { url: 'https://nice-fowl-6.clerk.accounts.dev/v1/client/handshake?redirect_url=x', status: 307 },
        ]);

        expect(findings).toHaveLength(1);
        expect(findings[0]).toContain('nice-fowl-6.clerk.accounts.dev');
    });

    it('flags nothing for a chain that stays on the app domain (a production instance)', () => {
        expect(
            findDevInstanceHandshakeHops([
                { url: 'https://commise.app/en', status: 308, location: 'https://www.commise.app/en' },
                { url: 'https://www.commise.app/en', status: 200 },
            ]),
        ).toEqual([]);
    });
});
