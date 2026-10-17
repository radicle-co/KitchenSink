/**
 * A DEPLOYED k6 SCENARIO MUST RUN ON A TOKEN MINTED WITHIN ITS LIFETIME.
 *
 * ⛔ THE DEFECT THIS EXISTS FOR, MEASURED — run 34041143051. The pool was minted at 15:17:37 and the
 * scenario legs then ran SEQUENTIALLY until 15:29:29. A Clerk session token lives about a minute, so:
 *
 *   - `searchLatency` (finished 15:19:35) succeeded 434 times out of 3884 — the ~60s before expiry;
 *   - every scenario after it answered `0 out of 12252`, `0 out of 1215`, `0 out of 3996` — total 401.
 *
 * ⚠️ AND THE WRONG CURE WAS ALMOST SHIPPED ON THE STRENGTH OF THE FIRST NUMBER ALONE. 88.82% failures on a
 * suite whose VU-to-pool ratio genuinely does exceed `RATE_LIMIT_SEARCH` reads exactly like throttling, and
 * a 429-tolerance change was written, reviewed against a guard, and committed before the LATER scenarios
 * were read. A limiter admits 60/min/user continuously; it cannot produce `0 out of 12252`. The zero is
 * what distinguishes expiry from throttling, and no test looked at it.
 *
 * ⛔ SO THE ASSERTION IS ON THE MINT, NOT ON THE FAILURE RATE. A rate-of-failure check cannot tell the two
 * causes apart — that is precisely how the wrong one got diagnosed — and it can only fail AFTER a run has
 * burned twenty minutes of sandbox. This asserts the structural property that makes expiry impossible:
 * every deployed scenario invocation is preceded, in its own step, by a re-mint.
 *
 * Re-minting is the cheap half by construction: `clerkSession.ts` holds the session and mints from
 * `POST /client/sessions/{id}/tokens`, which is NOT the per-IP-limited endpoint that sign-in is. Its own
 * docstring already specifies this exact case — "a caller that needs MANY tokens over a long run must hold
 * the handle and re-mint from it" — so the capability existed and simply was not wired to the k6 tier.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const WORKFLOW = join(REPO_ROOT, '.github/workflows/_ci-heavy.yml');

/** Source with block and line comments removed, so prose about a symbol is not read as a use of it. */
function withoutComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '');
}

/**
 * The steps of the deployed-load job that present a BEARER.
 *
 * ⚠️ Deliberately not "every step that runs k6": the shared-origin probe is unauthenticated on purpose —
 * its whole assertion is that `GET /api/v1/users/me` with no `Authorization` header is a 401 — so it has
 * no credential to keep fresh and requiring handles of it would be noise. A step that names a
 * `*_TOKENS_FILE` is exactly a step whose requests carry a token that can expire.
 */
function scenarioSteps(workflow: string): readonly string[] {
    return workflow
        .split(/^ {12}- name: /mu)
        .slice(1)
        .filter((step) => /_TOKENS_FILE:/u.test(step));
}

describe('the deployed k6 tier is handed what it needs to stay authenticated', () => {
    const workflow = readFileSync(WORKFLOW, 'utf8');

    it('has scenario steps to reason about at all', () => {
        // Guards the derivation itself: if the workflow's shape changes so no step matches, every
        // assertion below would pass over an empty list.
        expect(scenarioSteps(workflow).length).toBeGreaterThanOrEqual(3);
    });

    it('gives every k6 step the sign-in handles, not only the bearers', () => {
        // ⛔ A step handed `*_TOKENS_FILE` alone can only ever present the bearer it was born with. The
        // handles are what make the mid-run re-mint possible, so a step missing them is a leg that WILL
        // expire — silently, as thousands of 401s reported as service failures.
        const missing = scenarioSteps(workflow).filter((step) => !/_HANDLES_FILE:/u.test(step));

        expect(missing).toHaveLength(0);
    });

    it('never re-mints by signing in again', () => {
        // Sign-in is the per-IP limited half of Clerk's FAPI — the whole reason a pool is provisioned up
        // front. The refresher may only use the session-token endpoint.
        const refresher = withoutComments(
            readFileSync(join(REPO_ROOT, 'packages/tools/loadtest/k6/session.js'), 'utf8'),
        );

        expect(refresher).toMatch(/client\/sessions\/\$\{handle\.sessionId\}\/tokens/u);
        expect(refresher).not.toMatch(/sign_ins|establishSession/u);
    });
});

describe('a scenario longer than a token cannot outlive its credential', () => {
    // ⛔ THE SECOND HALF OF THE SAME DEFECT, and the one a per-leg re-mint does NOT fix. Every tier's
    // default shape is 30s ramp + 1m hold + 15s down = 105 seconds, against a bearer that lives 60
    // (measured: `exp - iat` on a live sandbox token is exactly 60). So even a leg handed a
    // freshly-minted pool spends its last ~45 seconds unauthenticated.
    //
    // ⚠️ The durations are `__ENV`-overridable, so "just run each leg for 45s" was available and is
    // REJECTED: it caps every future deployed scenario below a minute — no sustained behaviour is
    // observable at all — and it fails silently and invisibly the first time somebody raises HOLD.
    // Refreshing mid-run keeps correctness independent of the shape.
    const TIERS = ['recipe-service', 'food-service', 'identity'] as const;

    it.each(TIERS)('%s refreshes its bearer from the shared session module', (tier) => {
        const common = readFileSync(join(REPO_ROOT, `packages/services/${tier}/tests/load/lib/common.js`), 'utf8');

        // Shared because "how a bearer is kept fresh" is one piece of knowledge, and three copies of it
        // is what `natEgressConsumers.test.ts`'s docstring calls a list that cannot detect its own drift.
        expect(common).toMatch(/loadtest\/k6\/session\.js/u);
    });
});
